import { randomUUID } from 'crypto';
import Express from 'express';
import DungeonMaster from '../service/DungeonMaster.js';

const router = Express.Router();

const dungeons = {};

router.post('/', (req, res) => {
    const {owner} = req.body;
    let uuid = randomUUID().toString();
    let dm = new DungeonMaster(owner);
    dungeons[uuid] = {
        uuid,
        owner,
        ws: '/ws?dungeon=' + uuid,
        dm
    };
    dm.startGame();
});

router.get('/:uuid', (req, res) => {
    const {uuid} = req.params;
    const dungeon = dungeons[uuid];
    return res.json(dungeon);
});

export default router;