import CBDClient from './CBDClient.js';
import { attack, useAbility, createBuffMap, getTarget, spawnMonster, CommandResult } from '../components/commands.js';

const cbdApiUrl = process.env.BATTLE_API_URL;
const jwtToken = process.env.TWITCH_BOT_JWT;

export default class DungeonMaster {
    id;
    players = {};

    encounterTable = {};
    cooldownTable = {};

    itemTable = {};
    abilityTable = {};
    monsterTable = {};
    jobTable = {};

    buffTable = {};
    dotTable = {};

    cbdClient;
    broadcasterId;

    constructor(broadcasterId) {
        this.broadcasterId = broadcasterId;
        this.cbdClient = new CBDClient(cbdApiUrl, jwtToken);
    }

    startGame = async () => {
        let {abilityTable, itemTable, monsterTable, jobTable} = await this.cbdClient.getGameContext();
        this.abilityTable = abilityTable;
        this.itemTable = itemTable;
        this.monsterTable = monsterTable;
        this.jobTable = jobTable;

        // Start main loop
        this.mainLoop();
    }

    addPlayer = async playerId => {
        const player = await this.cbdClient.getCharacter(playerId);
        this.players[playerId] = {...player, buffs: []};
    }

    addMonster = (monsterName, personalName) => {
        let monster = spawnMonster(monsterName, personalName, this);
        this.encounterTable[monster.spawnKey] = {...monster, buffs: []};
        return monster.spawnKey;
    }

    removePlayer = async playerId => {
        let index = this.players.findIndex(player => playerId === player.name);

        if (index >= 0) {
            this.players.splice(index, 1);
        }
    }

    attack = (attackerName, defenderName) => {
        if (this.cooldownTable[attackerName]) {
            throw `${attackerName} is on cooldown.`;
        }

        let results = attack(attackerName, defenderName, this);

        results.forEach((result) => {
            this.handleResult(result);
        });

        // Set user cool down
        const currBuffs = createBuffMap(attackerName, this);
        const attacker = getTarget(attackerName, this);
        this.cooldownTable[attackerName] = Math.min(11, 6 - Math.min(5, attacker.dex + currBuffs.dex));
    }

    use = (attackerName, defenderName, abilityName) => {
        if (this.cooldownTable[attackerName]) {
            throw `${attackerName} is on cooldown.`;
        }

        let foundIndex = -1;
        let isItem = false;
        let itemName = null;
        let attacker = getTarget(attackerName, this);

        if (abilityName.startsWith("#")) {
            itemName = abilityName.substring(1).toUpperCase();
            let item = this.itemTable[itemName];
            foundIndex = attacker.inventory.findIndex(inventoryItem => inventoryItem.id === itemName);
    
            if (!item) {
                throw(`Item with id ${itemName} doesn't exist.`);
            }
    
            if (foundIndex < 0) {
                throw(`User doesn't have ${item.name} to use.`)
            }
    
            if (item.type.toUpperCase() !== "CONSUMABLE") {
                throw(`${item.name} is not consumable`);
            }
    
    
            abilityName = item.use;
            isItem = true;
        }
    
        let ability = this.abilityTable[abilityName];
    
        if (!ability) {
            throw `Ability named ${abilityName} doesn't exist goofball.`;
        }

        if (!attacker) {
            throw `${attackerName} doesn't have a battler.`;
        }
    
        if (!isItem && !attacker.abilities[abilityName]) {
            throw `${attackerName} doesn't have ability ${ability.name}.`;
        }
    
        if (isItem) {
            ability.ap = 0;
        }
    
        if (Math.max(0, attacker.ap) < ability.ap) {
            throw `@${attackerName} needs ${ability.ap} AP to use this ability.`;
        }

        let results = useAbility(attackerName, defenderName, ability, this);

        results.forEach((result) => {
            this.handleResult(result);
        });

        // If item, remove from inventory
        if (isItem) {
            // await Xhr.removeItem({name: attackerName}, itemName);
        }

        // Set user cool down
        let currBuffs = createBuffMap(attackerName, this);
        this.cooldownTable[attackerName] = Math.min(11, 6 - Math.min(5, attacker.dex + currBuffs.dex));
    }

    getTargets = () => {
        return this.encounterTable;
    }

    resetCooldown = (name) => {
        delete this.cooldownTable[name];
    }

    /**
     * 
     * @param {CommandResult} result 
     */
    handleResult = (result) => {
        result.messages.forEach((message) => {
            console.log(`MESSAGE: ${message}`);
        });

        result.adjustments.forEach(({subject, action, adjustmentKey, adjustmentValue}) => {
            // Adjust stats
            console.log(`${subject} [${action}] -> ${adjustmentKey}: ${adjustmentValue}`);

            let subjectObject = getTarget(subject, this);

            switch (action) {
            case "ADJUSTMENT":
                subjectObject[adjustmentKey] += adjustmentValue;
                break;
            case "ADD":
                subjectObject[adjustmentKey].push(adjustmentValue);
                break;
            case "REMOVE":
                subjectObject[adjustmentKey] = subjectObject[adjustmentKey].filter(({id}) => id === adjustmentValue);
                break;
            }

            if (subjectObject.isMonster) {
                this.encounterTable[subject.substring(1)][adjustmentKey] = subjectObject[adjustmentKey];
            } else {
                this.players[subject][adjustmentKey] = subjectObject[adjustmentKey];
            }
        });

        result.triggeredResults.forEach(this.handleResult);
    }

    mainLoop = async () => {
        // Handle all timing based things like monsters acting after cool down is done and buffs and dot's procing and expiring
    }
}