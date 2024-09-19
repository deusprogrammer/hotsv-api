import { randomUUID } from 'crypto';
import Express from 'express';
import DungeonMaster from '../service/DungeonMaster.js';

const router = Express.Router();

const dungeons = {};

router.post('/', (req, res) => {
    const {owner} = req.body;
    let uuid = randomUUID().toString();
    dungeons[uuid] = {
        uuid,
        owner,
        ws: '/ws?dungeon=' + uuid,
        dm: new DungeonMaster(owner)
    };
});

router.get('/:uuid', (req, res) => {
    const {uuid} = req.params;
    const dungeon = dungeons[uuid];
    return res.json(dungeon);
});

export default router;