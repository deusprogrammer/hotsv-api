const Util = require('../components/base/util');
const Xhr = require('../components/base/xhr');
const Commands = require('./commands');
const EventQueue = require('../components/base/eventQueue');
const { processMessage } = require('../bot');

let itemTable = {};
let jobTable = {};
let monsterTable = {};
let abilityTable = {};
let encounterTable = {};
let cooldownTable = {};
let buffTable = {};
let dotTable = {};

let pluginContext = {};

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

let sendContextUpdate = async (targets, botContext, shouldRefresh = false) => {
    let players = await Xhr.getActiveUsers(botContext);

    if (targets) {
        targets.forEach((target) => {
            EventQueue.sendEventTo(target.id, {
                type: 'CONTEXT',
                data: {
                    players,
                    monsters: encounterTable,
                    buffs: buffTable[target.name],
                    cooldown: cooldownTable[target.name],
                    shouldRefresh,
                },
            });
        });
    } else {
        EventQueue.sendEventTo(
            'ALL',
            {
                type: 'CONTEXT',
                data: {
                    players,
                    monsters: encounterTable,
                    shouldRefresh,
                },
            },
            shouldRefresh
        );
    }
};

exports.commands = {
    '!use': async (twitchContext, botContext) => {
        if (cooldownTable[twitchContext.username]) {
            throw `${twitchContext.username} is on cooldown.`;
        }

        // Set user active if they attack
        if (!botContext.chattersActive[twitchContext.username]) {
            botContext.chattersActive[twitchContext.username] = 10 * 12;
            EventQueue.sendEvent({
                type: 'JOIN',
                targets: ['chat', 'panel'],
                eventData: {
                    results: {
                        attacker: {
                            name: twitchContext.username,
                        },
                        message: `${twitchContext.username} joins the brawl!`,
                    },
                    encounterTable,
                },
            });
        }

        let attackerName = twitchContext.username;
        let abilityName = twitchContext.tokens[1].toUpperCase();
        let defenderName = twitchContext.tokens[2]
            ? twitchContext.tokens[2].replace('@', '').toLowerCase()
            : null;
        let foundIndex = -1;
        let isItem = false;
        let itemName = null;
        let attacker = await Commands.getTarget(attackerName, pluginContext);

        if (abilityName.startsWith('#')) {
            itemName = abilityName.substring(1).toUpperCase();
            let item = itemTable[itemName];
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

        let ability = abilityTable[abilityName];

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

        if (!isItem) {
            await EventQueue.sendEvent({
                type: 'INFO',
                targets: ['chat', 'panel'],
                eventData: {
                    results: {
                        attacker: {},
                        message: `${attackerName} uses ${ability.name}`,
                    },
                    encounterTable,
                },
            });
        } else {
            await EventQueue.sendEvent({
                type: 'INFO',
                targets: ['chat', 'panel'],
                eventData: {
                    results: {
                        attacker: {},
                        message: `${attackerName} uses a ${itemName}`,
                    },
                    encounterTable,
                },
            });
        }

        await Commands.use(attackerName, defenderName, ability, pluginContext);

        // If item, remove from inventory
        if (isItem) {
            await Xhr.removeItem({ name: attackerName }, itemName);
        }

        // Set user cool down
        let currBuffs = Commands.createBuffMap(
            twitchContext.username,
            pluginContext
        );
        cooldownTable[twitchContext.username] = Math.min(
            11,
            6 - Math.min(5, attacker.dex + currBuffs.dex)
        );

        //sendContextUpdate([updatedAttacker], botContext, true);
    },
    '!attack': async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.cbd) {
            throw 'This channel does not have this command enabled';
        }

        if (twitchContext.tokens.length < 2) {
            throw 'You must have a target for your attack.';
        }
        let attacker = await Commands.getTarget(
            twitchContext.username,
            pluginContext
        );
        let defenderName = twitchContext.tokens[1]
            .replace('@', '')
            .toLowerCase();

        if (cooldownTable[twitchContext.username]) {
            throw `${twitchContext.username} is on cooldown.`;
        }

        await Commands.attack(
            twitchContext.username,
            defenderName,
            pluginContext
        );

        // Set user cool down
        let currBuffs = Commands.createBuffMap(
            twitchContext.username,
            pluginContext
        );
        cooldownTable[twitchContext.username] = Math.min(
            11,
            6 - Math.min(5, attacker.dex + currBuffs.dex)
        );

        // Set user active if they attack
        if (!botContext.chattersActive[twitchContext.username]) {
            botContext.chattersActive[twitchContext.username] = 10 * 12;
            await EventQueue.sendEvent({
                type: 'JOIN',
                targets: ['chat', 'panel'],
                eventData: {
                    results: {
                        attacker: {
                            name: twitchContext.username,
                        },
                        message: `${twitchContext.username} joins the brawl!`,
                    },
                    encounterTable,
                },
            });
        }
    },
    '!explore': async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.cbd) {
            throw 'This channel does not have this command enabled';
        }

        // If there are too many encounters, fail
        if (
            Object.keys(encounterTable).length >=
            botContext.configTable.maxEncounters
        ) {
            throw `All adventurers are busy with monsters right now.`;
        }

        let randomMonster = null;
        let apCost = 5;
        let maxRarity = Util.rollDice('1d100') < 10 ? 7 : 5;
        const itemDrop = Util.rollDice('1d100') <= 20;

        // Potential item drop
        if (itemDrop) {
            if (twitchContext.tokens.length >= 2) {
                maxRarity *= 2;
                apCost = 10;
            }

            const items = Object.keys(itemTable).filter(
                (name) => itemTable[name].rarity < maxRarity
            );
            const foundItemKey = items[Util.randomNumber(items.length) - 1];
            const foundItem = itemTable[foundItemKey];

            let user = { name: twitchContext.username };
            await Xhr.giveItem(user, foundItemKey);
            await Xhr.adjustStats(user, { ap: -apCost });

            EventQueue.sendEvent({
                type: 'ITEM_GET',
                targets: ['chat', 'panel'],
                eventData: {
                    results: {
                        receiver: {
                            name: twitchContext.username,
                        },
                        item: foundItem,
                        message: `${twitchContext.username} found ${foundItem.name}!`,
                    },
                    encounterTable,
                },
            });
            sendContextUpdate([twitchContext.caller], botContext, true);
            return;
        }

        // Monster spawn
        if (twitchContext.tokens.length < 2) {
            let lowLevelMonsters = Object.keys(monsterTable).filter(
                (name) => monsterTable[name].rarity < maxRarity
            );
            randomMonster =
                lowLevelMonsters[
                    Util.randomNumber(lowLevelMonsters.length) - 1
                ];
        } else {
            let dungeonMonsters = Object.keys(monsterTable).filter(
                (name) =>
                    monsterTable[name].rarity < maxRarity * 2 &&
                    monsterTable[name].dungeon === twitchContext.tokens[1]
            );

            if (!dungeonMonsters) {
                throw `No dungeon by the name ${twitchContext.tokens[1]}`;
            }

            randomMonster =
                dungeonMonsters[Util.randomNumber(dungeonMonsters.length) - 1];
            apCost = 10;
        }

        // Retrieve monster from monster table
        let monsterName = randomMonster;
        let monster = await Commands.spawnMonster(
            monsterName,
            null,
            pluginContext
        );
        encounterTable[monster.spawnKey] = monster;

        // Expend AP
        await Xhr.adjustStats(
            { name: twitchContext.username },
            { ap: -apCost }
        );

        EventQueue.sendEvent({
            type: 'SPAWN',
            targets: ['chat', 'panel'],
            eventData: {
                results: {
                    message: `${monster.name} has appeared!  Target name: ~${monster.spawnKey}.`,
                },
                encounterTable,
            },
        });

        sendContextUpdate(null, botContext, true);
    },
    '!spawn': async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.cbd) {
            throw 'This channel does not have this command enabled';
        }

        if (
            twitchContext.username !== botContext.botConfig.twitchChannel &&
            !twitchContext.mod
        ) {
            throw 'Only a broadcaster or mod can spawn monsters';
        }

        // If there are too many encounters, fail
        if (
            Object.keys(encounterTable).length >=
            botContext.configTable.maxEncounters
        ) {
            throw `Only ${botContext.configTable.maxEncounters} monster spawns allowed at a time`;
        }

        let monster = null;
        if (twitchContext.tokens.length < 2) {
            // Retrieve a random monster from the present dungeon
            const dungeonName = botContext.configTable.currentDungeon;

            if (!dungeonName) {
                throw 'If no current dungeon is defined, then the spawn command requires a monster name.';
            }

            const maxRarity = Util.rollDice('1d100') < 10 ? 7 : 5;
            const dungeonMonsters = Object.keys(monsterTable).filter(
                (name) =>
                    monsterTable[name].rarity < maxRarity * 2 &&
                    monsterTable[name].dungeon === dungeonName
            );
            const randomMonsterName =
                dungeonMonsters[Util.randomNumber(dungeonMonsters.length) - 1];
            monster = await Commands.spawnMonster(
                randomMonsterName,
                null,
                pluginContext
            );
        } else {
            // Retrieve monster from monster table
            const monsterName = twitchContext.tokens[1];
            monster = await Commands.spawnMonster(
                monsterName,
                null,
                pluginContext
            );
        }

        encounterTable[monster.spawnKey] = monster;

        EventQueue.sendEvent({
            type: 'SPAWN',
            targets: ['chat', 'panel'],
            eventData: {
                results: {
                    message: `${monster.name} has appeared!  Target name: ~${monster.spawnKey}.`,
                },
                encounterTable,
            },
        });

        sendContextUpdate(null, botContext);
    },
    '!stats': async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.cbd) {
            throw 'This channel does not have this command enabled';
        }

        let username = twitchContext.username;
        if (
            twitchContext.tokens[1] &&
            twitchContext.tokens[1].startsWith('~')
        ) {
            username = twitchContext.tokens[1].slice(1);
            let monster = encounterTable[username];
            let buffs = Commands.createBuffMap(`~${username}`, pluginContext);
            EventQueue.sendInfoToChat(
                `[${monster.name}] HP: ${monster.hp} -- STR: ${
                    monster.str
                } (${Util.sign(buffs.str)}) -- DEX: ${monster.dex} (${Util.sign(
                    buffs.dex
                )}) -- INT: ${monster.int} (${Util.sign(buffs.int)}) -- HIT: ${
                    monster.hit
                } (${Util.sign(buffs.hit)}) -- AC: ${monster.ac} (${Util.sign(
                    buffs.ac
                )}) -- Cooldown: ${cooldownTable[username] * 5 || '0'} seconds.`
            );
            return;
        } else if (
            twitchContext.tokens[1] &&
            !twitchContext.tokens[1].startsWith('~')
        ) {
            username = twitchContext.tokens[1].replace('@', '').toLowerCase();
        }

        let buffs = Commands.createBuffMap(username, pluginContext);
        let user = await Xhr.getUser(username);
        user = Util.expandUser(user, pluginContext);
        EventQueue.sendInfoToChat(
            `[${user.name}] HP: ${user.hp} -- AP: ${user.ap} -- STR: ${
                user.str
            } (${Util.sign(buffs.str)}) -- DEX: ${user.dex} (${Util.sign(
                buffs.dex
            )}) -- INT: ${user.int} (${Util.sign(buffs.int)}) -- HIT: ${
                user.hit
            } (${Util.sign(buffs.hit)}) -- AC: ${user.totalAC} (${Util.sign(
                buffs.ac
            )}) -- Cooldown: ${cooldownTable[username] * 5 || '0'} seconds.`
        );
    },
    '!buffs': async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.cbd) {
            throw 'This channel does not have this command enabled';
        }

        let username = twitchContext.username;
        let buffList = buffTable[username] || [];
        EventQueue.sendInfoToChat(
            `[${username} Buffs] ${buffList
                .map((buff) => `${buff.name}(${buff.duration * 5} seconds)`)
                .join(', ')}.`
        );
    },
    '!targets': async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.cbd) {
            throw 'This channel does not have this command enabled';
        }

        let activeUsers = await Xhr.getActiveUsers(pluginContext);
        let monsterList = Object.keys(encounterTable).map((name) => {
            let monster = encounterTable[name];
            if (monster.hp >= 0) {
                return `${monster.name} (~${name})`;
            }
        });
        EventQueue.sendInfoToChat(
            `Available targets are: ${[...activeUsers, ...monsterList]}`
        );
    },
};

exports.init = async (botContext) => {
    itemTable = await Xhr.getItemTable();
    jobTable = await Xhr.getJobTable();
    monsterTable = await Xhr.getMonsterTable();
    abilityTable = await Xhr.getAbilityTable();

    console.log(`* All tables loaded`);

    pluginContext = {
        itemTable,
        jobTable,
        monsterTable,
        abilityTable,
        encounterTable,
        cooldownTable,
        buffTable,
        dotTable,
        ...botContext,
    };

    try {
        setInterval(async () => {
            // Check for chatter activity timeouts
            for (let username in botContext.chattersActive) {
                botContext.chattersActive[username] -= 1;
                if (botContext.chattersActive[username] === 0) {
                    delete botContext.chattersActive[username];
                    EventQueue.sendInfoToChat(
                        `${username} has stepped back into the shadows.`
                    );
                }
            }

            // Tick down human cooldowns
            for (let username in cooldownTable) {
                cooldownTable[username] -= 1;
                if (cooldownTable[username] <= 0) {
                    delete cooldownTable[username];
                    EventQueue.sendInfoToChat(`${username} can act again.`);
                    let user = Xhr.getUser(username);
                    EventQueue.sendEventToUser(user, {
                        type: 'COOLDOWN_OVER',
                    });
                }
            }

            // Tick down buff timers
            for (let username in buffTable) {
                let buffs = buffTable[username] || [];
                buffs.forEach((buff) => {
                    buff.duration--;

                    if (buff.duration <= 0) {
                        let expandedUsername = username;
                        if (username.startsWith('~')) {
                            expandedUsername = 'Unknown';
                            let monster = encounterTable[username.slice(1)];
                            if (monster) {
                                expandedUsername = monster.name || 'Unknown';
                            }
                        }
                        EventQueue.sendInfoToChat(
                            `${expandedUsername}'s ${buff.name} buff has worn off.`
                        );
                    }
                });
                buffTable[username] = buffs.filter((buff) => buff.duration > 0);

                // If not a monster, send buff updates to user
                if (!username.startsWith('~')) {
                    let user = await Xhr.getUser(username);
                    EventQueue.sendEventToUser(user, {
                        type: 'BUFF_UPDATE',
                        data: {
                            buffs: buffTable[username],
                        },
                    });
                }
            }

            // Tick down status timers
            for (let username in dotTable) {
                let effects = dotTable[username];
                for (let effect of effects) {
                    effect.tickCounter--;
                    if (effect.tickCounter <= 0) {
                        effect.tickCounter = effect.ability.procTime;
                        effect.cycles--;

                        // Perform damage
                        let defender = null;
                        try {
                            defender = await Commands.getTarget(
                                username,
                                pluginContext
                            );
                            if (defender.hp <= 0) {
                                effect.cycles = 0;
                                continue;
                            }
                        } catch (e) {
                            effect.cycles = 0;
                            break;
                        }
                        let damageRoll = Util.rollDice(effect.ability.dmg);

                        if (!defender.isMonster) {
                            let adjustments = {};
                            adjustments[effect.ability.damageStat] =
                                -damageRoll;
                            await Xhr.adjustStats(
                                { name: username },
                                adjustments
                            );

                            sendContextUpdate([user], botContext, true);
                        } else {
                            defender.hp -= damageRoll;
                        }

                        // Send panel update
                        EventQueue.sendEvent({
                            type: 'ATTACKED',
                            targets: ['chat', 'panel'],
                            eventData: {
                                results: {
                                    defender,
                                    message: `${
                                        defender.name
                                    } took ${damageRoll} damage from ${
                                        effect.ability.name
                                    } ${defender.hp <= 0 ? ' and died.' : '.'}`,
                                },
                                encounterTable,
                            },
                        });

                        // Send update to all users if monster died.
                        if (defender.hp <= 0 && defender.isMonster) {
                            effect.cycles = 0;

                            delete encounterTable[defender.spawnKey];

                            let itemGets = await Commands.distributeLoot(
                                defender,
                                pluginContext
                            );
                            itemGets.forEach((itemGet) => {
                                EventQueue.sendEvent(itemGet);
                            });

                            continue;
                        }

                        if (effect.cycles <= 0) {
                            EventQueue.sendInfoToChat(
                                `${defender.name}'s ${effect.ability.name} status has worn off.`
                            );
                        }
                    }
                }
                dotTable[username] = effects.filter(
                    (effect) => effect.cycles > 0
                );

                // If not a monster, send effect updates to user
                if (!username.startsWith('~')) {
                    let user = await Xhr.getUser(username);
                    EventQueue.sendEventToUser(user, {
                        type: 'STATUS_UPDATE',
                        data: {
                            effects: dotTable[username],
                        },
                    });
                }
            }

            // Do monster attacks
            for (let encounterName in encounterTable) {
                let encounter = encounterTable[encounterName];

                if (encounter.hp <= 0) {
                    return;
                }

                // If the monster has no tick, reset it.
                if (encounter.tick === undefined) {
                    let buffs = Commands.createBuffMap(
                        '~' + encounter.name,
                        pluginContext
                    );
                    encounter.tick = Math.min(
                        11,
                        6 - Math.min(5, encounter.dex + buffs.dex)
                    );
                }

                // If cooldown timer for monster is now zero, do an attack.
                if (encounter.tick === 0) {
                    let buffs = Commands.createBuffMap(
                        '~' + encounter.name,
                        pluginContext
                    );
                    encounter.tick = Math.min(
                        11,
                        6 - Math.min(5, encounter.dex + buffs.dex)
                    );

                    // If no aggro, pick randomly.  If aggro, pick highest damage dealt.
                    let target = null;
                    if (
                        !encounter.aggro ||
                        Object.keys(encounter.aggro).length <= 0
                    ) {
                        let activeUsers = await Xhr.getActiveUsers(
                            pluginContext
                        );

                        if (activeUsers.length > 0) {
                            target =
                                activeUsers[
                                    Math.floor(
                                        Math.random() *
                                            Math.floor(activeUsers.length)
                                    )
                                ];
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
                        let diceRoll = Util.rollDice('1d' + chanceSum);

                        // Figure out which action triggers
                        let lowerThreshold = 0;
                        let triggeredAction = 'ATTACK';
                        let ability = null;
                        encounter.actions.forEach((action) => {
                            let upperThreshold = lowerThreshold + action.chance;

                            if (
                                diceRoll > lowerThreshold &&
                                diceRoll <= upperThreshold
                            ) {
                                triggeredAction = action.abilityId;
                                ability = abilityTable[triggeredAction];
                            }

                            lowerThreshold = upperThreshold;
                        });

                        if (
                            triggeredAction !== 'ATTACK' &&
                            ability.area === 'ONE'
                        ) {
                            EventQueue.sendInfoToChat(
                                `${encounter.name} uses ${ability.name}`
                            );
                            if (ability.target === 'ENEMY') {
                                await Commands.use(
                                    '~' + encounterName,
                                    target,
                                    ability,
                                    pluginContext
                                );
                            } else {
                                if (ability.element === 'HEALING') {
                                    let lowestHP = encounter;
                                    let lowestHPKey = encounterName;
                                    for (otherEncounterKey in encounterTable) {
                                        let otherEncounter =
                                            encounterTable[otherEncounterKey];
                                        if (otherEncounter.hp < lowestHP.hp) {
                                            lowestHP = otherEncounter;
                                            lowestHPKey = otherEncounterKey;
                                        }
                                    }

                                    await Commands.use(
                                        '~' + encounterName,
                                        '~' + lowestHPKey,
                                        ability,
                                        pluginContext
                                    );
                                } else if (ability.element === 'CLEANSING') {
                                    // TODO Add cleansing AI
                                }
                            }
                        } else if (
                            triggeredAction !== 'ATTACK' &&
                            ability.area === 'ALL'
                        ) {
                            EventQueue.sendInfoToChat(
                                `${encounter.name} uses ${ability.name}`
                            );
                            await Commands.use(
                                '~' + encounterName,
                                null,
                                ability,
                                pluginContext
                            );
                        } else {
                            await Commands.attack(
                                '~' + encounterName,
                                target,
                                pluginContext
                            );
                        }

                        return;
                    }
                }

                encounter.tick--;
            }
        }, 5 * 1000);
    } catch (e) {
        EventQueue.sendEvent({
            type: 'ERROR',
            targets: ['chat'],
            eventData: {
                results: {
                    message: e,
                },
                encounterTable,
            },
        });
    }
};

exports.bitsHook = async ({ bits, userName, userId }, botContext) => {
    if (!botContext.botConfig.config.rewards) {
        return;
    }

    console.log('BITS: ' + userName + ' - ' + bits);
    let user = await Xhr.getUser(userName);

    if (!user) {
        user = await Xhr.createUser(userName, userId);
        EventQueue.sendEvent({
            type: 'INFO',
            targets: ['chat'],
            eventData: {
                results: {
                    message: `@${userName} got ${bits} gold for cheering.`,
                },
            },
        });
    }

    await Xhr.addCurrency(user, bits);

    EventQueue.sendEvent({
        type: 'INFO',
        targets: ['chat'],
        eventData: {
            results: {
                message: `@${userName} got ${bits} gold for cheering.`,
            },
        },
    });
};

exports.subscriptionHook = async (
    { userName, userId, subPlan },
    botContext
) => {
    if (!botContext.botConfig.config.rewards) {
        return;
    }

    let user = await Xhr.getUser(userName);

    if (!user) {
        user = await Xhr.createUser(userName, userId);
    }

    if (subPlan !== 'prime') {
        await Xhr.addCurrency(user, parseInt(subPlan));
    }

    EventQueue.sendEvent({
        type: 'INFO',
        targets: ['chat'],
        eventData: {
            results: {
                message: `@${userName} got ${subPlan} gold for subscribing.`,
            },
        },
    });
};

exports.redemptionHook = async (
    { rewardTitle, userName, userId },
    botContext
) => {
    if (rewardTitle.toUpperCase().startsWith('AP')) {
        let groups = rewardTitle.match(/AP\s*\+\s*([0-9]+)/);

        if (!groups && groups.length < 2) {
            EventQueue.sendEvent({
                type: 'INFO',
                targets: ['chat'],
                eventData: {
                    results: {
                        message: `Invalid reward name ${rewardTitle}`,
                    },
                },
            });
            return;
        }

        let amount = groups[1];
        await Xhr.chargeAP(userName, parseInt(amount));
        EventQueue.sendEvent({
            type: 'INFO',
            targets: ['chat'],
            eventData: {
                results: {
                    message: `@${userName} charged ${amount} AP.`,
                },
            },
        });
    } else if (rewardTitle.toUpperCase().startsWith('REVIVE')) {
        await Xhr.reviveAvatar(userName);

        EventQueue.sendEvent({
            type: 'INFO',
            targets: ['chat'],
            eventData: {
                results: {
                    message: `@${userName} revived.`,
                },
            },
        });
    } else if (rewardTitle.toUpperCase().startsWith('CREATE BATTLER')) {
        await Xhr.createUser(userName, userId);
        EventQueue.sendEvent({
            type: 'INFO',
            targets: ['chat'],
            eventData: {
                results: {
                    message: `@${userName} created a battler.`,
                },
            },
        });
    } else {
        return;
    }

    sendContextUpdate(null, botContext);
};

exports.onWsMessage = async (event, ws, botContext) => {
    if (event.type === 'COMMAND') {
        processMessage(
            botContext.botConfig.twitchChannel,
            { username: event.fromUser, 'user-id': event.from, mod: false },
            event.message,
            false
        );
        const caller = {
            id: event.from,
            name: event.fromUser,
        };
        sendContextUpdate([caller]);
    } else if (event.type === 'CONTEXT' && event.to !== 'ALL') {
        let players = await Xhr.getActiveUsers(botContext);
        ws.send(
            JSON.stringify({
                type: 'CONTEXT',
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: EventQueue.createJwt(botContext.botConfig.sharedSecretKey),
                to: event.from,
                data: {
                    players,
                    monsters: encounterTable,
                    cooldown: cooldownTable[event.fromUser],
                    buffs: buffTable[event.fromUser],
                },
            })
        );
    }
};

exports.wsInitHook = (from) => {
    EventQueue.sendEventToPanels({
        to: from,
        eventData: {
            results: {},
            encounterTable,
        },
    });
};
