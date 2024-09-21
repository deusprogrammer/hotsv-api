import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import WebSocket from 'ws';
import { randomUuid } from '../utils.js';

// Keys for jwt verification
const key = process.env.TWITCH_SHARED_SECRET;
const defaultSecret = Buffer.from(key, 'base64');

const hmacSHA1 = (hmacSecret, data) => {
    return crypto.createHmac('sha1', hmacSecret).update(data).digest().toString('base64');
}

const users = {};
const dungeons = {};

// Heartbeat interval
const sockets = [];
setInterval(() => {
    sockets.forEach((ws) => {
        ws.send(JSON.stringify({
            event: "PING"
        }));
    });
}, 30 * 1000);

export const startWebsocketServer = (port) => {
    console.log("Started websocket server");
    // Setup websocket server for communicating with the panel
    const wss = new WebSocket.Server({ port });

    // Set up a websocket routing system
    wss.on('connection', async (ws) => {
        console.log("CONNECTION");

        if (!(ws in sockets)) {
            sockets.push(ws);
        }

        ws.on('close', async () => {
            // TODO Clean up users and dungeons when they disconnect
            console.log("Websocket closed, cleaning up.");
        });

        ws.on('message', async (message) => {
            console.log("MESSAGE: \n" + message);
            const messageData = JSON.parse(message);
            const { userType, event, channelId, jwtToken, data, signature } = messageData;

            if (userType === 'PANEL') {
                switch (event) {
                    case 'JOIN': {
                        if (!(channelId in dungeons)) {
                            ws.send(JSON.stringify({ 
                                event: "ERROR", 
                                channelId, 
                                message: "Cannot connect to dungeon: " + channelId
                            }));
                            ws.close();
                            return;
                        }

                        dungeons[channelId].panels.push({
                            ws
                        });

                        ws.send(JSON.stringify({ 
                            event: 'JOINED', 
                            channelId
                        }));
                        break;
                    }
                }
                return;
            }

            jwt.verify(
                jwtToken,
                defaultSecret,
                async (err, decoded) => {
                    if (err) {
                        console.log("Error verifying JWT: " + err);
                        return ws.send(JSON.stringify({ 
                            event: "ERROR", 
                            channelId, 
                            message: "Error verifying JWT: " + err 
                        }));
                    }

                    const { user_id : userId, roles } = decoded;
                    let signingKey = "";

                    if (userType === "PLAYER") {
                        signingKey = players[userId].signingKey;
                    } else if (userType === 'DM') {
                        signingKey = dms[userId].signingKey;
                    }

                    switch (event) {
                        case 'JOIN':
                            let newSigningKey = randomUuid();
                            if (userType === 'PLAYER') {
                                if (!(channelId in dungeons)) {
                                    ws.send(JSON.stringify({ 
                                        event: "ERROR", 
                                        channelId, 
                                        message: "Cannot connect to dungeon: " + channelId
                                    }));
                                    ws.close();
                                    return;
                                }

                                users[userId] = {
                                    ...users[userId],
                                    channelId,
                                    signingKey: newSigningKey,
                                    ws
                                };

                                if (!(userId in dungeons[channelId].players)) {
                                    dungeons[channelId].players.push(userId);
                                }
                            } else if (userType === 'DM') {
                                if (!roles.includes("TWITCH_BOT")) {
                                    ws.close();
                                }

                                dungeons[channelId] = {
                                   ...dungeons[userId],
                                    channelId,
                                    signingKey: newSigningKey,
                                    players: [],
                                    panels: [],
                                    ws
                                };
                            }

                            ws.send(JSON.stringify({ 
                                event: 'JOINED', 
                                channelId,
                                signingKey: newSigningKey
                            }));
                            break;
                        case 'ACTION': {
                            // Validate signature
                            let actualSignature = hmacSHA1(signingKey, JSON.stringify(data));

                            if (actualSignature !== signature) {
                                console.log("Invalid signature");
                                return ws.send(JSON.stringify({ 
                                    event: 'ERROR', 
                                    channelId, 
                                    message: "Invalid signature" 
                                }));
                            }

                            // Communicate with dm
                            const signature = hmacSHA1(dungeon.signingKey, JSON.stringify(data));
                            const dungeon = dungeons[channelId];
                            dungeon.ws.send(JSON.stringify({
                                ...messageData,
                                signature,
                                jwtToken: null
                            }));

                            break;
                        }
                        case 'UPDATE': {
                            // Validate signature
                            let actualSignature = hmacSHA1(signingKey, JSON.stringify(data));

                            if (actualSignature !== signature) {
                                console.log("Invalid signature");
                                return ws.send(JSON.stringify({ 
                                    event: 'ERROR', 
                                    channelId, 
                                    message: "Invalid signature" 
                                }));
                            }

                            const dungeon = dungeons[channelId];

                            // Communicate with players
                            dungeon.players.forEach(playerId => {
                                const {signingKey: playerSigningKey, ws: playerWs} = players[playerId];
                                const playerSignature = hmacSHA1(playerSigningKey, JSON.stringify(data));

                                playerWs.send(JSON.stringify({
                                    ...messageData,
                                    signature: playerSignature,
                                    jwtToken: null
                                }));
                            });

                            // Communicate with panels
                            dungeon.panels.forEach(({ws: panelWs}) => {
                                panelWs.send(JSON.stringify({
                                    ...messageData,
                                    jwtToken: null
                                 }));
                            });

                            break;
                        }
                    }
                }
            );
        });
    });
}