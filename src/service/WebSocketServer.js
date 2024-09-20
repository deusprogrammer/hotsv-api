import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import WebSocket from 'ws';
import { randomUuid } from '../utils';

// Keys for jwt verification
const key = process.env.TWITCH_SHARED_SECRET;
const defaultSecret = Buffer.from(key, 'base64');

const hmacSHA1 = (hmacSecret, data) => {
    return crypto.createHmac('sha1', hmacSecret).update(data).digest().toString('base64');
}

const users = {};
const dungeons = {};

export const startWebsocketServer = (port) => {
    // Setup websocket server for communicating with the panel
    const wss = new WebSocket.Server({ port });

    // Set up a websocket routing system
    wss.on('connection', async (ws) => {
        console.log("CONNECTION");

        ws.on('close', async () => {
            console.log("Websocket closed, cleaning up.");

            // Remove dead connections (TODO this apparently doesn't work perfectly yet)
            Object.keys(clients).filter((key) => {return clients[key].readyState !== WebSocket.OPEN}).forEach((key) => {
                console.log("Removing dead connection for client: " + key);
                delete clients[key];

                // Close websockets that are connected to bot
                let channelId = key.replace("BOT-", "");
                panels[channelId].forEach((panel) => {
                    panel.close();
                });
                delete panels[channelId];
            });

            // Remove dead panels
            Object.keys(panels).forEach((channelId) => {
                let channelPanels = panels[channelId];
                panels[channelId] = channelPanels.filter((channelPanel) => {return channelPanel.readyState === WebSocket.OPEN});
            });

            console.log("BOTS CONNECTED: " + Object.keys(clients).length);
        });

        ws.on('message', async (message) => {
            const messageData = JSON.parse(message);
            const { userType, event, channelId, jwtToken, data, signature } = messageData;

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

                            // Communicate with players
                            const dungeon = dungeons[channelId];
                            dungeon.players.forEach(playerId => {
                                const playerSigningKey = players[playerId].signingKey;
                                const signature = hmacSHA1(playerSigningKey, JSON.stringify(data));
                                playerId.ws.send(JSON.stringify({
                                    ...messageData,
                                    signature,
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