import DungeonMaster from './service/DungeonMaster.js';

let channelId = process.argv[2];

console.log(`Game Master v1.0 Started for Channel ${channelId}`)

let dm = new DungeonMaster(channelId);
dm.startGame();