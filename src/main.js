import express from 'express';
import cors from 'cors';
import dungeonRoute from './routes/dungeonRoute.js';
import { startWebsocketServer } from './service/WebSocketServer.js';

let app = express();

app.use(express.json({limit: "50Mb"}))
app.use(cors());

app.use('/dungeons', dungeonRoute);

app.listen(3001);
startWebsocketServer(3002);