import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import WebSocket from 'ws';
import { randomUuid } from '../utils.js';
import CBDClient from './CBDClient.js';

const cbdApiUrl = process.env.BATTLE_API_URL;
const jwtToken = process.env.TWITCH_BOT_JWT;

// Keys for jwt verification
const key = process.env.TWITCH_SHARED_SECRET;
const defaultSecret = Buffer.from(key, 'base64');

const hmacSHA1 = (hmacSecret, data) => {
    return crypto
        .createHmac('sha1', hmacSecret)
        .update(data)
        .digest()
        .toString('base64');
};

const users = {};
const dungeons = {};

// Heartbeat interval
const sockets = [];
setInterval(() => {
    sockets.forEach((ws) => {
        ws.send(
            JSON.stringify({
                event: 'PING',
            })
        );
    });
}, 30 * 1000);

export const startWebsocketServer = async (port) => {
    console.log('Started websocket server');

    const cbdClient = new CBDClient(cbdApiUrl, jwtToken);
    await cbdClient.loadGameData();
    const gameContext = await cbdClient.getGameContext();

    const wss = new WebSocket.Server({ port });

    // Set up a websocket routing system
    wss.on('connection', async (ws) => {
        console.log('CONNECTION');

        if (!(ws in sockets)) {
            sockets.push(ws);
        }

        ws.on('close', async () => {
            // TODO Clean up users and dungeons when they disconnect
            console.log('Websocket closed, cleaning up.');
        });

        ws.on('message', async (message) => {
            const messageData = JSON.parse(message);
            const {
                userType,
                event,
                channelId,
                jwtToken,
                data,
                signature,
                action,
            } = messageData;

            if (userType === 'PANEL') {
                switch (event) {
                    case 'JOIN': {
                        if (!(channelId in dungeons)) {
                            ws.send(
                                JSON.stringify({
                                    event: 'ERROR',
                                    channelId,
                                    message:
                                        'Cannot connect to dungeon: ' +
                                        channelId,
                                })
                            );
                            ws.close();
                            return;
                        }

                        dungeons[channelId].panels.push({
                            ws,
                        });

                        ws.send(
                            JSON.stringify({
                                event: 'JOINED',
                                channelId,
                            })
                        );
                        break;
                    }
                }
                return;
            }

            const secret = userType === 'PLAYER' ? defaultSecret : key;

            jwt.verify(jwtToken, secret, async (err, decoded) => {
                if (err) {
                    console.log('Error verifying JWT: ' + err);
                    return ws.send(
                        JSON.stringify({
                            event: 'ERROR',
                            channelId,
                            message: 'Error verifying JWT: ' + err,
                        })
                    );
                }

                console.log('DECODED: ' + JSON.stringify(decoded, null, 5));

                const { login: userId, user_id: id, role } = decoded;
                let signingKey = '';

                if (userType === 'PLAYER') {
                    signingKey = users[userId]?.signingKey;
                } else if (userType === 'DM') {
                    signingKey = dungeons[userId]?.signingKey;
                }

                switch (event) {
                    case 'JOIN':
                        let newSigningKey = randomUuid();
                        if (userType === 'PLAYER') {
                            // Check if dungeon exists
                            if (!(channelId in dungeons)) {
                                ws.send(
                                    JSON.stringify({
                                        event: 'ERROR',
                                        channelId,
                                        message:
                                            'Cannot connect to dungeon: ' +
                                            channelId,
                                    })
                                );
                                ws.close();
                                return;
                            }

                            // Check if player exists
                            let playerData;
                            try {
                                playerData = await cbdClient.getCharacter(
                                    userId
                                );
                            } catch (error) {
                                console.error(
                                    'Error connecting user: ' + error
                                );
                                ws.send(
                                    JSON.stringify({
                                        event: 'ERROR',
                                        channelId,
                                        message:
                                            'Error connecting user: ' + error,
                                    })
                                );
                                ws.close();
                                return;
                            }

                            // Add user to map of connected users
                            users[userId] = {
                                ...users[userId],
                                channelId,
                                signingKey: newSigningKey,
                                playerData,
                                ws,
                            };

                            // Check if player is in dungeon already and if they aren't, add them
                            if (!(userId in dungeons[channelId].players)) {
                                dungeons[channelId].players.push(userId);
                            }

                            // Send a player joined message to the dungeon
                            dungeons[channelId].ws.send(
                                JSON.stringify({
                                    event: 'ACTION',
                                    userType: 'PLAYER',
                                    channelId,
                                    action: {
                                        type: 'PLAYER_JOIN',
                                        actor: userId,
                                    },
                                    jwtToken: jwt,
                                })
                            );

                            // Send a joined message with the player data and the initial game context
                            ws.send(
                                JSON.stringify({
                                    event: 'JOINED',
                                    gameContext,
                                    playerData,
                                })
                            );
                        } else if (userType === 'DM') {
                            if (role !== 'DM' || id !== `DM-${channelId}`) {
                                console.log('You done fucked up');
                                ws.close();
                            }

                            dungeons[channelId] = {
                                ...dungeons[userId],
                                channelId,
                                signingKey: newSigningKey,
                                players: [],
                                panels: [],
                                ws,
                            };
                        }

                        ws.send(
                            JSON.stringify({
                                event: 'JOINED',
                                channelId,
                                signingKey: newSigningKey,
                            })
                        );
                        break;
                    case 'ACTION': {
                        // Validate signature
                        // let actualSignature = hmacSHA1(signingKey, JSON.stringify(data));

                        // if (actualSignature !== signature) {
                        //     console.log("Invalid signature");
                        //     return ws.send(JSON.stringify({
                        //         event: 'ERROR',
                        //         channelId,
                        //         message: "Invalid signature"
                        //     }));
                        // }

                        // Communicate with dm
                        // const signature = hmacSHA1(dungeon.signingKey, JSON.stringify(data));
                        const dungeon = dungeons[channelId];
                        dungeon.ws.send(
                            JSON.stringify({
                                ...messageData,
                                signature,
                                jwtToken: null,
                            })
                        );

                        break;
                    }
                    case 'UPDATE': {
                        // Validate signature
                        // let actualSignature = hmacSHA1(signingKey, JSON.stringify(data));

                        // if (actualSignature !== signature) {
                        //     console.log("Invalid signature");
                        //     return ws.send(JSON.stringify({
                        //         event: 'ERROR',
                        //         channelId,
                        //         message: "Invalid signature"
                        //     }));
                        // }

                        const dungeon = dungeons[channelId];

                        let {to} = messageData;
                        if (to) {
                            const {
                                signingKey: playerSigningKey,
                                ws: playerWs,
                            } = users[to];

                            playerWs.send(
                                JSON.stringify({
                                    ...messageData,
                                    signature: 'playerSignature',
                                    jwtToken: null,
                                })
                            );
                            break;
                        }

                        // Communicate with players
                        dungeon.players.forEach((playerId) => {
                            const {
                                signingKey: playerSigningKey,
                                ws: playerWs,
                            } = users[playerId];
                            // const playerSignature = hmacSHA1(playerSigningKey, JSON.stringify(data));

                            playerWs.send(
                                JSON.stringify({
                                    ...messageData,
                                    signature: 'playerSignature',
                                    jwtToken: null,
                                })
                            );
                        });

                        // Communicate with panels
                        dungeon.panels.forEach(({ ws: panelWs }) => {
                            panelWs.send(
                                JSON.stringify({
                                    ...messageData,
                                    jwtToken: null,
                                })
                            );
                        });
                        break;
                    }
                    case "ERROR":
                        let {to} = messageData;
                        if (to) {
                            const {
                                signingKey: playerSigningKey,
                                ws: playerWs,
                            } = users[to];

                            playerWs.send(
                                JSON.stringify({
                                    ...messageData,
                                    signature: 'playerSignature',
                                    jwtToken: null,
                                })
                            );
                            break;
                        }
                        break;
                }
            });
        });
    });
};
