import WebSocket from 'ws';
import jsonwebtoken from 'jsonwebtoken';
import CBDClient from './CBDClient.js';
import {
    attack,
    useAbility,
    createBuffMap,
    getTarget,
    spawnMonster,
    CommandResult,
} from '../components/commands.js';
import { rollDice } from '../utils.js';

const cbdApiUrl = process.env.BATTLE_API_URL;
const jwtToken = process.env.TWITCH_BOT_JWT;

// Keys for jwt verification
const sharedKey = process.env.TWITCH_SHARED_SECRET;

const hmacSHA1 = (hmacSecret, data) => {
    return crypto
        .createHmac('sha1', hmacSecret)
        .update(data)
        .digest()
        .toString('base64');
};

const createExpirationDate = () => {
    var d = new Date();
    var year = d.getFullYear();
    var month = d.getMonth();
    var day = d.getDate();
    var c = new Date(year + 1, month, day);
    return c;
};

const createJwt = (secret, channelId) => {
    return jsonwebtoken.sign(
        {
            exp: createExpirationDate().getTime(),
            user_id: `DM-${channelId}`,
            role: 'DM',
            channel_id: channelId,
        },
        secret
    );
};

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
    messages = [];
    events = [];

    cbdClient;
    broadcasterId;
    socket;

    constructor(broadcasterId) {
        this.broadcasterId = broadcasterId;
        this.cbdClient = new CBDClient(cbdApiUrl, jwtToken);
    }

    startGame = async () => {
        let { abilityTable, itemTable, monsterTable, jobTable } =
            await this.cbdClient.getGameContext();
        this.abilityTable = abilityTable;
        this.itemTable = itemTable;
        this.monsterTable = monsterTable;
        this.jobTable = jobTable;

        // Setup websocket to communicate with extension
        this.socket = new WebSocket('ws://localhost:3002');

        this.socket.on('open', () => {
            this.socket.send(
                JSON.stringify({
                    event: 'JOIN',
                    userType: 'DM',
                    channelId: this.broadcasterId,
                    jwtToken: createJwt(sharedKey, this.broadcasterId),
                })
            );
        });

        this.socket.on('message', (message) => {
            let { event } = JSON.parse(message);

            if (event !== 'ACTION') {
                return;
            }

            let {
                action: { type, actor, targets, argument },
            } = JSON.parse(message);

            try {
                switch (type) {
                    case 'PLAYER_JOIN':
                        this._addPlayer(actor);
                        break;
                    case 'PLAYER_LEAVE':
                        this._removePlayer(actor);
                        break;
                    case 'SPAWN_MONSTER':
                        this._addMonster(actor);
                        break;
                    case 'ATTACK':
                        this._attack(actor, targets);
                        break;
                    case 'USE':
                        this._use(actor, targets, argument);
                        break;
                }

                // Filter out dead monsters
                let keysToDelete = Object.keys(this.encounterTable).filter((key) => this.encounterTable[key].hp <= 0);
                keysToDelete.forEach((key) => delete this.encounterTable[key]);

                this._broadcastUpdate();
            } catch (error) {
                console.error('Error processing command: ' + error);
                this._sendError(actor, error);
            }
        });

        this.socket.on('close', (e) => {});

        this.socket.on('error', (e) => {
            console.error(
                'Socket encountered error: ',
                e.message,
                'Closing socket'
            );
            extWs.close();
        });

        // Start main loop to run every 5 seconds
        setInterval(this._mainLoop, 1000 * 5);
    };

    _broadcastUpdate = async () => {
        this.socket.send(
            JSON.stringify({
                event: 'UPDATE',
                channelId: this.broadcasterId,
                jwtToken: createJwt(sharedKey, this.broadcasterId),
                dungeon: {
                    players: this.players,
                    monsters: this.encounterTable,
                    buffs: this.buffTable,
                    dots: this.dotTable,
                    messages: this.messages,
                    events: this.events,
                    cooldowns: this.cooldownTable
                },
            })
        );
    }

    _sendUpdate = async (username) => {
        this.socket.send(
            JSON.stringify({
                event: 'UPDATE',
                channelId: this.broadcasterId,
                to: username,
                jwtToken: createJwt(sharedKey, this.broadcasterId),
                dungeon: {
                    players: this.players,
                    monsters: this.encounterTable,
                    buffs: this.buffTable,
                    dots: this.dotTable,
                    messages: this.messages,
                    cooldowns: this.cooldownTable
                },
            })
        );
    }

    _sendError = async (username, error) => {
        this.socket.send(
            JSON.stringify({
                event: 'ERROR',
                channelId: this.broadcasterId,
                to: username,
                jwtToken: createJwt(sharedKey, this.broadcasterId),
                error
            })
        );
    }

    _addPlayer = async (playerId) => {
        this.messages.push(playerId + " joined dungeon");
        const player = await this.cbdClient.getCharacter(playerId);
        player.hp = player.maxHp;
        player.dots = [];
        player.buffs = [];
        player.items = [];
        this.players[playerId] = { ...player, buffs: [] };
    };

    _addMonster = (monsterName, personalName) => {
        let monster = spawnMonster(monsterName, personalName, this);
        this.messages.push(monster.name + " appeared");
        this.encounterTable[monster.spawnKey] = { ...monster, buffs: [], dots: [] };
        return monster.spawnKey;
    };

    _removePlayer = async (playerId) => {
        this.messages.push(playerId + " left dungeon");

        let index = this.players.findIndex(
            (player) => playerId === player.name
        );

        if (index >= 0) {
            this.players.splice(index, 1);
        }
    };

    _attack = (attackerName, defenderName) => {
        if (this.cooldownTable[attackerName]) {
            throw `${attackerName} is on cooldown.`;
        }

        this.messages.push(`${attackerName} attacks`);

        let results = attack(attackerName, defenderName, this);

        results.forEach((result) => {
            this._handleResult(result);
        });

        // Set user cool down
        const currBuffs = createBuffMap(attackerName, this);
        const attacker = getTarget(attackerName, this);
        this.cooldownTable[attackerName] = Math.min(
            11,
            6 - Math.min(5, attacker.dex + currBuffs.dex)
        );
    };

    _use = (attackerName, defenderName, abilityName) => {
        if (this.cooldownTable[attackerName]) {
            throw `${attackerName} is on cooldown.`;
        }

        let foundIndex = -1;
        let isItem = false;
        let itemName = null;
        let attacker = getTarget(attackerName, this);

        if (abilityName.startsWith('#')) {
            itemName = abilityName.substring(1).toUpperCase();
            let item = this.itemTable[itemName];
            foundIndex = attacker.inventory.findIndex(
                (inventoryItem) => inventoryItem.id === itemName
            );

            if (!item) {
                throw `Item with id ${itemName} doesn't exist.`;
            }

            if (foundIndex < 0) {
                throw `User doesn't have ${item.name} to use.`;
            }

            if (item.type.toUpperCase() !== 'CONSUMABLE') {
                throw `${item.name} is not consumable`;
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
            this.messages.push(`${attackerName} used ${item.name}`);
        } else {
            this.messages.push(`${attackerName} used ${ability.name}`);
        }

        if (Math.max(0, attacker.ap) < ability.ap) {
            throw `@${attackerName} needs ${ability.ap} AP to use this ability.`;
        }

        let results = useAbility(attackerName, defenderName, ability, this);

        results.forEach((result) => {
            this._handleResult(result);
        });

        // If item, remove from inventory
        if (isItem) {
            // await Xhr.removeItem({name: attackerName}, itemName);
        }

        // Set user cool down
        let currBuffs = createBuffMap(attackerName, this);
        this.cooldownTable[attackerName] = Math.min(
            11,
            6 - Math.min(5, attacker.dex + currBuffs.dex)
        );
    };

    _getTargets = () => {
        return this.encounterTable;
    };

    _resetCooldown = (name) => {
        delete this.cooldownTable[name];
    };

    /**
     *
     * @param {CommandResult} result
     */
    _handleResult = (result) => {
        result.messages.forEach((message) => {
            console.log(`MESSAGE: ${message}`);
            this.messages.push(message);
        });

        result.adjustments.forEach(
            ({ subject, action, adjustmentKey, adjustmentValue }) => {
                // Adjust stats
                console.log(
                    `${subject} [${action}] -> ${adjustmentKey}: ${adjustmentValue}`
                );

                let subjectObject = getTarget(subject, this);

                switch (action) {
                    case 'ADJUSTMENT':
                        subjectObject[adjustmentKey] += adjustmentValue;
                        break;
                    case 'ADD':
                        subjectObject[adjustmentKey].push(adjustmentValue);
                        break;
                    case 'REMOVE':
                        subjectObject[adjustmentKey] = subjectObject[
                            adjustmentKey
                        ].filter(({ id }) => id === adjustmentValue);
                        break;
                }

                if (subjectObject.isMonster) {
                    this.encounterTable[subject.substring(1)][adjustmentKey] =
                        subjectObject[adjustmentKey];
                } else {
                    this.players[subject][adjustmentKey] =
                        subjectObject[adjustmentKey];
                }
            }
        );

        result.triggeredResults.forEach(this._handleResult);
    };

    _mainLoop = async () => {
        const results = [];
        const commandResult = new CommandResult();

        // Use this.socket.send() to send messages to the server
        // Tick down human cooldowns
        for (let username in this.cooldownTable) {
            this.cooldownTable[username] -= 1;
            if (this.cooldownTable[username] <= 0) {
                delete this.cooldownTable[username];
            }
        };
        
        // Tick down buff timers
        for(let username in this.players) {
            console.log(`BUFFS[${username}]: ${JSON.stringify(this.players[username].buffs, null, 5)}`);
            let buffs = this.players[username].buffs;
            buffs.forEach((buff) => {
                buff.duration--;
                if (buff.duration <= 0) {
                    let expandedUsername = username;
                    if (username.startsWith("~")) {
                        expandedUsername = "Unknown";
                        let monster = this.encounterTable[username.slice(1)];
                        if (monster) {
                            expandedUsername = monster.name || "Unknown";
                        }
                    }
                    console.log(`${expandedUsername}'s ${buff.name} buff has worn off.`);
                    this.messages.push(`${expandedUsername}'s ${buff.name} buff has worn off.`);
                }
            });
            this.players[username].buffs = buffs.filter(buff => buff.duration > 0);
        };
        for(let username in this.encounterTable) {
            console.log(`BUFFS[${username}]: ${JSON.stringify(this.encounterTable[username].buffs, null, 5)}`);
            let buffs = this.encounterTable[username].buffs;
            buffs.forEach((buff) => {
                buff.duration--;
                if (buff.duration <= 0) {
                    let expandedUsername = username;
                    if (username.startsWith("~")) {
                        expandedUsername = "Unknown";
                        let monster = this.encounterTable[username.slice(1)];
                        if (monster) {
                            expandedUsername = monster.name || "Unknown";
                        }
                    }
                    this.messages.push(`${expandedUsername}'s ${buff.name} buff has worn off.`);
                }
            });
            this.encounterTable[username].buffs = buffs.filter(buff => buff.duration > 0);
        };

        // Tick down status timers for players
        for (let username in this.players) {
            console.log(`DOTS BEFORE[${username}]: ${JSON.stringify(this.players[username].dots, null, 5)}`);
            let effects = this.players[username].dots;
            for (let effect of effects) {
                effect.tickCounter--;
                if (effect.tickCounter <= 0) {
                    effect.tickCounter = effect.ability.procTime;
                    effect.cycles--;

                    // Perform damage
                    let defender = null;
                    try {
                        defender = getTarget(username, this);
                        if (defender.hp <= 0) {
                            effect.cycles = 0;
                            continue;
                        }
                    } catch (e) {
                        console.error("Failed to get target");
                        effect.cycles = 0;
                        break;
                    }

                    let damageRoll = rollDice(effect.ability.dmg);

                    commandResult.withAdjustment(username, effect.ability.damageStat, -damageRoll);
                    this.messages.push(`${defender.name} took ${damageRoll} damage from ${effect.ability.name} ${defender.hp <= 0 ? " and died." : "."}`);

                    // Send update to all users if monster died.
                    if (defender.hp <= 0 && defender.isMonster) {
                        effect.cycles = 0;
                        delete this.encounterTable[defender.spawnKey];
                        // TODO Reimplement loot distribution
                        // let itemGets = distributeLoot(defender, pluginContext);
                        // itemGets.forEach((itemGet) => {
                        //     // EventQueue.sendEvent(itemGet);
                        // });
                        continue;
                    }
                    if (effect.cycles <= 0) {
                        this.messages.push(`${defender.name}'s ${effect.ability.name} status has worn off.`);
                    }
                }
            }

            this.players[username].dots = effects.filter(effect => effect.cycles > 0);
            console.log(`DOTS AFTER[${username}]: ${JSON.stringify(this.players[username].dots, null, 5)}`);
        }
        // Tick down status timers for monsters
        for (let username in this.encounterTable) {
            console.log(`DOTS BEFORE[${username}]: ${JSON.stringify(this.encounterTable[username].dots, null, 5)}`);
            let effects = this.encounterTable[username].dots;
            for (let effect of effects) {
                effect.tickCounter--;
                if (effect.tickCounter <= 0) {
                    effect.tickCounter = effect.ability.procTime;
                    effect.cycles--;

                    // Perform damage
                    let defender = null;
                    try {
                        defender = getTarget(username, this);
                        if (defender.hp <= 0) {
                            effect.cycles = 0;
                            continue;
                        }
                    } catch (e) {
                        console.error("Failed to get target");
                        effect.cycles = 0;
                        break;
                    }

                    let damageRoll = rollDice(effect.ability.dmg);

                    commandResult.withAdjustment(username, effect.ability.damageStat, -damageRoll);
                    this.messages.push(`${defender.name} took ${damageRoll} damage from ${effect.ability.name} ${defender.hp <= 0 ? " and died." : "."}`);

                    // Send update to all users if monster died.
                    if (defender.hp <= 0 && defender.isMonster) {
                        effect.cycles = 0;
                        delete this.encounterTable[defender.spawnKey];
                        // TODO Reimplement loot distribution
                        // let itemGets = distributeLoot(defender, pluginContext);
                        // itemGets.forEach((itemGet) => {
                        //     // EventQueue.sendEvent(itemGet);
                        // });
                        continue;
                    }
                    if (effect.cycles <= 0) {
                        this.messages.push(`${defender.name}'s ${effect.ability.name} status has worn off.`);
                    }
                }
            }

            this.encounterTable[username].dots = effects.filter(effect => effect.cycles > 0);
            console.log(`DOTS AFTER[${username}]: ${JSON.stringify(this.encounterTable[username].dots, null, 5)}`);
        }

        // Do monster attacks
        for (let encounterName in this.encounterTable) {
            let encounter = this.encounterTable[encounterName];

            if (encounter.hp <= 0) {
                continue;
            }

            // If the monster has no tick, reset it.
            if (encounter.tick === undefined) {
                let buffs = createBuffMap("~" + encounterName, this);
                encounter.tick = Math.min(11, 6 - Math.min(5, encounter.dex + buffs.dex));
            }

            // If cooldown timer for monster is now zero, do an attack.
            if (encounter.tick === 0) {
                let buffs = createBuffMap("~" + encounterName, this);
                encounter.tick = Math.min(11, 6 - Math.min(5, encounter.dex + buffs.dex));

                // If no aggro, pick randomly.  If aggro, pick highest damage dealt.
                let target = null;
                if (!encounter.aggro || Object.keys(encounter.aggro).length <= 0) {
                    let activeUsers = Object.keys(this.players).filter((username) => this.players[username].hp >= 0);
                    if (activeUsers.length > 0) {
                        target = activeUsers[Math.floor(Math.random() * Math.floor(activeUsers.length))];
                    }
                } else {
                    Object.keys(encounter.aggro).forEach((attackerName) => {
                        let attackerAggro = encounter.aggro[attackerName];
                        if (target === null) {
                            target = attackerName;
                            return;
                        }
                        if (attackerAggro > encounter.aggro[target]) {
                            target = attackerName;
                        }
                    });
                }

                // If a target was found
                if (target !== null) {
                    // Check for ability triggers.
                    let chanceSum = 0;
                    encounter.actions.forEach((action) => {
                        chanceSum += action.chance;
                    });

                    // Roll dice
                    let diceRoll = rollDice("1d" + chanceSum);

                    // Figure out which action triggers.
                    let lowerThreshold = 0;
                    let triggeredAction = "ATTACK";
                    let ability = null;
                    encounter.actions.forEach((action) => {
                        let upperThreshold = lowerThreshold + action.chance;
                        if (diceRoll > lowerThreshold && diceRoll <= upperThreshold) {
                            triggeredAction = action.abilityId;
                            ability = this.abilityTable[triggeredAction];
                        }
                        lowerThreshold = upperThreshold;
                    });

                    if (triggeredAction !== "ATTACK" && ability.area === "ONE") {
                        this.messages.push(`${encounter.name} uses ${ability.name}`);
                        if (ability.target === "ENEMY") {
                            results.push(useAbility("~" + encounterName, target, ability, this));
                        } else {
                            if (ability.element === "HEALING") {
                                let lowestHP = encounter;
                                let lowestHPKey = encounterName;
                                for (otherEncounterKey in this.encounterTable) {
                                    let otherEncounter = this.encounterTable[otherEncounterKey];
                                    if (otherEncounter.hp < lowestHP.hp) {
                                        lowestHP = otherEncounter;
                                        lowestHPKey = otherEncounterKey;
                                    }
                                }
                                results.push(useAbility("~" + encounterName, "~" + lowestHPKey, ability, this));
                            } else if (ability.element === "CLEANSING") {
                                // TODO Add cleansing AI
                            }
                        }
                    } else if (triggeredAction !== "ATTACK" && ability.area === "ALL") {
                        this.messages.push(`${encounter.name} uses ${ability.name}`);
                        results.push(useAbility("~" + encounterName, null, ability, this));
                    } else {
                        results.push(attack("~" + encounterName, target, this));
                    }
                }
            }
            encounter.tick--;
        }

        // Handle results
        if (results.length > 0) {
            results.forEach((resultList) => {
                resultList.forEach((result) => {
                    this._handleResult(result);
                });
            });
        }

        // Broadcast a dungeon wide update
        this._broadcastUpdate();
    };
}
