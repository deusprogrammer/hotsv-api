import express from 'express';
import dungeonRoute from './routes/dungeonRoute.js';
import DungeonMaster from './service/DungeonMaster.js';

// let app = express();

// app.use('/dungeon', dungeonRoute);

// app.listen(3001);

(async() => {
    let dm = new DungeonMaster("12345678");
    await dm.startGame();
    await dm.addPlayer("thetruekingofspace");
    dm.addMonster("GATO");
    dm.attack("thetruekingofspace", `~M1`);
    dm.attack("~M1", "thetruekingofspace");
    dm.resetCooldown("thetruekingofspace");
    // dm.use("thetruekingofspace", "~M1", "CHARGED_ATTACK");
    dm.resetCooldown("thetruekingofspace");
    dm.use("thetruekingofspace", null, "HEALING_SHOWER");
    dm.resetCooldown("thetruekingofspace");
    dm.use("thetruekingofspace", null, "POWER_SHOWER");
})();