import express from 'express';
import dungeonRoute from './routes/dungeonRoute.js';
import DungeonMaster from './service/DungeonMaster.js';
import { startWebsocketServer } from './service/WebSocketServer.js';

let app = express();

app.use('/dungeon', dungeonRoute);

app.listen(3001);
startWebsocketServer(3002);