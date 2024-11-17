import { rollDice, shuffle } from '../utils.js';

export const ADJUSTMENT = 'ADJUSTMENT';
export const ADD = 'ADD';
export const REMOVE = 'REMOVE';

// Stats
const HP = 'hp';
const AP = 'ap';
const ITEMS = 'items';
const BUFFS = 'buffs';
const DOTS = 'dots';

export class StatAdjustment {
    subject;
    action;
    adjustmentKey;
    adjustmentValue;

    constructor(subject, action, adjustmentKey, adjustmentValue) {
        this.subject = subject;
        this.action = action;
        this.adjustmentKey = adjustmentKey;
        this.adjustmentValue = adjustmentValue;
    }
}

export class CommandResult {
    action;
    actor;
    target;
    flags = {
        hit: false,
        crit: false,
        dead: false,
    };
    adjustments = [];
    triggeredResults = [];
    messages = [];

    static create = () => {
        return new CommandResult();
    };

    withAction = (action) => {
        this.action = action;
        return this;
    };

    withActor = (actor) => {
        this.actor = actor;
        return this;
    };

    withTarget = (target) => {
        this.target = target;
        return this;
    };

    withEvent = (subject, action, adjustmentKey, adjustmentValue) => {
        this.adjustments.push(
            new StatAdjustment(subject, action, adjustmentKey, adjustmentValue)
        );
        return this;
    };

    withAdjustment = (subject, adjustmentKey, adjustmentValue) => {
        return this.withEvent(
            subject,
            ADJUSTMENT,
            adjustmentKey,
            adjustmentValue
        );
    };

    withAdd = (subject, adjustmentKey, adjustmentValue) => {
        return this.withEvent(subject, ADD, adjustmentKey, adjustmentValue);
    };

    withRemove = (subject, adjustmentKey, adjustmentValue) => {
        return this.withEvent(subject, REMOVE, adjustmentKey, adjustmentValue);
    };

    withTriggeredResult = (result) => {
        this.triggeredResults.push(result);
        return this;
    };

    withCritFlag = (critFlag) => {
        this.flags.crit = critFlag;
        return this;
    };

    withDeadFlag = (deadFlag) => {
        this.flags.dead = deadFlag;
        return this;
    };

    withHitFlag = (hitFlag) => {
        this.flags.hit = hitFlag;
        return this;
    };

    withMessage = (message) => {
        this.messages.push(message);
        return this;
    };
}

export const createBuffMap = (username, context) => {
    let target = getTarget(username, context);

    let buffs = target.buffs || [];
    let buffMap = {
        str: 0,
        dex: 0,
        int: 0,
        hit: 0,
        ac: 0,
    };

    console.log('BUFFS: ' + JSON.stringify(target.buffs, null, 5));

    buffs.forEach((buff) => {
        buff.changes.forEach((change) => {
            buffMap[change.stat.toLowerCase()] += change.amount;
        });
    });

    return buffMap;
};

export const getTarget = (targetName, context) => {
    let target = {};
    if (targetName.startsWith('~')) {
        targetName = targetName.substring(1).toUpperCase();
        target = context.encounterTable[targetName];
        if (!target) {
            throw `${targetName} is not a valid monster`;
        }

        target.isMonster = true;
        target.equipment = {
            hand: {
                dmg: target.dmg || '1d6',
                dmgStat: target.dmgStat || 'HP',
                toHitStat: target.toHitStat || 'HIT',
                triggers: [],
                mods: {
                    hit: target.hit,
                },
            },
        };
        target.totalAC = target.ac;
        target.encounterTableKey = targetName;
    } else {
        target = { ...context.players[targetName] };

        if (!target) {
            throw `@${targetName} doesn't have a battle avatar.`;
        }

        target.isMonster = false;
    }

    return target;
};

const distributeLoot = (monster, context) => {
    let lootDrops = [];
    let monsterDrops = [
        ...context.monsterTable[monster.id].drops.map((drop) => {
            return { ...drop };
        }),
    ];
    let taken = {};
    for (var attacker in shuffle(monster.aggro)) {
        for (var i in monsterDrops) {
            let drop = monsterDrops[i];

            let chanceRoll = rollDice('1d100');
            console.log('CHANCE: ' + chanceRoll + ' vs ' + drop.chance);
            if (
                chanceRoll < drop.chance &&
                !(drop.exclusive && drop.exclusiveTaken)
            ) {
                // If only one of these can drop for a given monster
                if (drop.onlyOne && taken[drop.itemId]) {
                    continue;
                }

                taken[drop.itemId] = true;

                lootDrops.push({
                    subject: attacker,
                    item: context.itemTable[drop.itemId],
                });
            }
        }
    }

    return lootDrops;
};

/**
 *
 * @param {*} attackerName
 * @param {*} defenderName
 * @param {*} ability
 * @param {*} context
 * @param {*} isTrigger
 * @param {*} performTriggers
 * @returns {CommandResult}
 */
const hurt = (
    attackerName,
    defenderName,
    ability,
    context,
    isTrigger = false,
    performTriggers = true
) => {
    const commandResult = CommandResult.create()
        .withAction(ability)
        .withActor(attackerName)
        .withTarget(defenderName);

    if (ability.element === 'HEALING' || ability.element === 'BUFFING') {
        throw `@${ability.name} is not an attack ability`;
    }

    let attacker = getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    if (!attacker.isMonster && attacker.ap < ability.ap) {
        throw `@${attackerName} needs ${ability.ap} AP to use ${ability.name}.`;
    }

    let defender = getTarget(defenderName, context);

    if (defender && !(defenderName in context.players) && !defender.isMonster) {
        throw `@${defenderName}'s not here man!`;
    }

    if (defender.hp <= 0) {
        throw `@${defenderName} is already dead.`;
    }

    let attackerBuffs = createBuffMap(attackerName, context);
    let defenderBuffs = createBuffMap(defenderName, context);

    // Find resistance
    let resistance = defender.resistances[ability.element.toLowerCase()];
    if (!resistance) {
        resistance = 0;
    }
    resistance = (100 - resistance * 5) / 100;

    let defenderAdjustments = {};
    let attackerAdjustments = {};

    let attackRoll = rollDice('1d20');
    let modifiedAttackRoll =
        attackRoll +
        attacker[ability.toHitStat.toLowerCase()] +
        ability.mods[ability.toHitStat.toLowerCase()] +
        attackerBuffs[ability.toHitStat.toLowerCase()];
    let damageRoll = rollDice(
        ability.dmg,
        defender[ability.dmgStat.toLowerCase()]
    );
    let modifiedDamageRoll = Math.ceil(
        Math.max(
            1,
            damageRoll + attacker.str + ability.mods.str + attackerBuffs.str
        ) * resistance
    );
    let hit = true;
    let crit = false;
    let dead = false;
    let encounterTable = context.encounterTable;

    if (ability.ignoreDamageMods) {
        modifiedDamageRoll = damageRoll;
    }

    console.log(
        `ATTACK ROLL ${modifiedAttackRoll} (${attackRoll} + ${
            attacker[ability.toHitStat.toLowerCase()]
        } + ${ability.mods[ability.toHitStat.toLowerCase()]} + ${
            attackerBuffs[ability.toHitStat.toLowerCase()]
        }) vs AC ${defender.totalAC + defenderBuffs.ac} (${
            defender.totalAC
        } + ${defenderBuffs.ac})`
    );
    console.log(
        `DAMAGE ROLL ${modifiedDamageRoll} (${damageRoll} + ${attacker.str} + ${ability.mods.str} + ${attackerBuffs.str})`
    );

    let message;
    if (attackRoll === 20 && !isTrigger) {
        modifiedDamageRoll *= 2.0;
        crit = true;
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}${ability.dmgStat}`;
    } else if (
        modifiedAttackRoll >= defender.totalAC + defenderBuffs.ac ||
        isTrigger
    ) {
        modifiedDamageRoll *= 1.0;
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}${ability.dmgStat}`;
    } else if (attackRoll === 1) {
        hit = false;
        message = `${attacker.name} ==> ${defender.name} MISS`;
    } else {
        modifiedDamageRoll = Math.ceil(modifiedDamageRoll * 0.5);
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}${ability.dmgStat}`;
    }

    let endStatus;
    if (hit && modifiedDamageRoll >= defender.hp && ability.dmgStat === 'HP') {
        endStatus = `[DEAD]`;
        dead = true;
    } else {
        if (ability.dmgStat === 'HP') {
            endStatus = `[${defender.hp - modifiedDamageRoll}/${
                defender.maxHp
            }HP]`;
        } else {
            endStatus = `[${defender.name} lost ${modifiedDamageRoll}${ability.dmgStat}]`;
        }
    }

    if (defender.isMonster) {
        if (!defender.aggro[attackerName]) {
            defender.aggro[attackerName] = 0;
        }
        defender.aggro[attackerName] += modifiedDamageRoll;
    }

    // Determine if proc damage occurs
    if (hit) {
        defenderAdjustments[ability.dmgStat.toLowerCase()] =
            -modifiedDamageRoll;

        // If this ability does DOT, then add an entry to the dotTable
        if (ability.procTime > 0 && !dead) {
            if (!context.dotTable[defenderName]) {
                context.dotTable[defenderName] = [];
            }

            // Check for existing effect
            let existingEffect = context.dotTable[defenderName].find(
                (entry) => entry.ability.id === ability.id
            );
            if (!existingEffect) {
                // Add new effect
                context.dotTable[defenderName].push({
                    ability,
                    tickCounter: ability.procTime,
                    cycles: ability.maxProcs,
                });
            } else {
                // Reset cycles left if already existing
                existingEffect.cycles = ability.maxProcs;
            }
        }
    }

    // Add ap adjustment
    attackerAdjustments.ap = -ability.ap;
    commandResult.withAdjustment(attackerName, AP, -ability.ap);

    // Update attacker stats
    if (!attacker.isMonster) {
        console.log(
            'ATTACKER ADJUSTMENTS: ' +
                JSON.stringify(attackerAdjustments, null, 5)
        );
    }

    // Update defender stats
    if (!defender.isMonster && hit) {
        console.log(
            'DEFENSE ADJUSTMENTS: ' +
                JSON.stringify(defenderAdjustments, null, 5)
        );
    } else if (defender.isMonster && hit) {
        console.log(
            'DEFENSE ADJUSTMENTS: ' +
                JSON.stringify(defenderAdjustments, null, 5)
        );
        if (ability.dmgStat.toLowerCase() === 'hp') {
            commandResult.withAdjustment(
                defenderName,
                ability.dmgStat.toLowerCase(),
                defenderAdjustments.hp
            );
        }
    }

    // Send messages for damage dealing
    if (hit) {
        let damage = ability.ignoreDamageMods ? damageRoll : modifiedDamageRoll;
        let damageStat = ability.dmgStat;
        let damageSource =
            ability.name !== 'attack' ? ability.name : attacker.name;
        let message = `${damageSource} dealt ${damage} ${damageStat} damage to ${defender.name}.`;
        if (crit) {
            message = `${damageSource} dealt ${damage} ${damageStat} critical damage to ${defender.name}.`;
        }

        commandResult.withMessage(message);

        // Display whether the enemy was weak to the element of the ability
        if (resistance > 1) {
            commandResult.withMessage(
                `${defender.name} is weak to ${ability.element.toLowerCase()}`
            );
        } else if (resistance < 1) {
            commandResult.withMessage(
                `${
                    defender.name
                } is resistant to ${ability.element.toLowerCase()}`
            );
        }
    } else {
        commandResult.withMessage(
            `${attacker.name} attacked ${defender.name} and missed.`
        );
    }

    if (dead) {
        if (defender.isMonster) {
            delete encounterTable[defender.spawnKey];
            let lootDrops = distributeLoot(defender, context);

            // Assign loot drops
            lootDrops.forEach(({ subject, item }) => {
                commandResult.withAdd(subject, ITEMS, item);
            });
        }

        commandResult.withMessage(
            `${defender.name} was slain by ${attacker.name}.`
        );
    }

    // Perform triggers
    if (hit && !dead && performTriggers) {
        for (const trigger of ability.triggers) {
            let triggerRoll = rollDice('1d20');
            let results = [];
            let ability = context.abilityTable[trigger.abilityId];
            trigger.ability = ability;

            if (triggerRoll <= trigger.chance) {
                commandResult.withMessage(
                    `${attacker.name}'s ${attacker.equipment.hand.name}'s ${trigger.ability.name} activated!`
                );
                switch (ability.element) {
                    case 'HEALING':
                        results = heal(
                            attackerName,
                            attackerName,
                            ability,
                            context
                        );
                        break;
                    case 'BUFFING':
                        results = heal(
                            attackerName,
                            attackerName,
                            ability,
                            context
                        );
                        break;
                    default:
                        results = hurt(
                            attackerName,
                            defenderName,
                            ability,
                            context,
                            true,
                            true
                        );
                        break;
                }

                commandResult.withTriggeredResult(results);
            }
        }
    }

    return commandResult
        .withMessage(`[BATTLE]: ${message}  ${hit ? endStatus : ''}`)
        .withCritFlag(crit)
        .withHitFlag(hit)
        .withDeadFlag(dead);
};

/**
 *
 * @param {*} attackerName
 * @param {*} defenderName
 * @param {*} ability
 * @param {*} context
 * @returns {CommandResult}
 */
const buff = (attackerName, defenderName, ability, context) => {
    if (ability.element !== 'BUFFING') {
        throw `@${ability.name} is not a buffing ability`;
    }

    let commandResult = CommandResult.create()
        .withAction(ability.name)
        .withActor(attackerName)
        .withTarget(defenderName);

    let attacker = getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    if (!attacker.isMonster && attacker.ap < ability.ap) {
        throw `@${attackerName} needs ${ability.ap} to use ${ability.name}.`;
    }

    let defender = getTarget(defenderName, context);

    let tokens = ability.buffs.split(';');
    let changes = tokens.map((token) => {
        let groups = token.match(/(STR|DEX|INT|HIT|AC)\+*(\-*[0-9]+)(%*)/);

        if (!groups && groups.length < 3) {
            throw `Bad buff string on ability ${ability.name}`;
        }

        let amount = parseInt(groups[2]);
        if (groups[3] === '%') {
            amount = Math.ceil(
                defender[groups[1].toLowerCase()] * (amount / 100)
            );
        }

        return {
            stat: groups[1],
            amount,
        };
    });

    // Combine with other buffs
    let existingBuffs = context.buffTable[defenderName] || [];
    let existingBuff = existingBuffs.find((buff) => buff.id === ability.id);
    if (existingBuff) {
        console.log('User already has buff');
        existingBuff.duration = ability.buffsDuration;
    } else {
        commandResult.withAdd(defenderName, BUFFS, {
            id: ability.id,
            name: ability.name,
            duration: ability.buffsDuration,
            changes,
        });
    }

    // Adjust attacker ap if player
    if (!attacker.isMonster) {
        commandResult.withAdjustment(attackerName, AP, -ability.ap);
    }

    commandResult.withMessage(
        `${defender.name} is affected by ${ability.name}`
    );

    return commandResult;
};

/**
 *
 * @param {*} attackerName
 * @param {*} defenderName
 * @param {*} ability
 * @param {*} context
 * @returns {CommandResult}
 */
const cleanse = (attackerName, defenderName, ability, context) => {
    if (ability.element !== 'CLEANSING') {
        throw `@${ability.name} is not a cleansing ability`;
    }

    let commandResult = CommandResult.create()
        .withAction(ability.name)
        .withActor(attackerName)
        .withTarget(defenderName);

    let attacker = getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    // Check is user has enough ap
    if (!attacker.isMonster && attacker.ap < ability.ap) {
        throw `@${attackerName} needs ${ability.ap} AP to use ${ability.name}.`;
    }

    let defender = getTarget(defenderName, context);

    let tokens = ability.buffs.split(';');
    tokens.forEach((token) => {
        let groups = token.match(/\-([a-zA-Z0-9_]+)/);

        if (!groups && groups.length < 2) {
            throw `Bad cleansing string on ability ${ability.name}`;
        }

        let effectToRemove = groups[1];

        commandResult.withMessage(
            `${defender.name} is cured of ${effectToRemove}`
        );
        commandResult.withRemove(defenderName, BUFFS, effectToRemove);
        commandResult.withRemove(defenderName, DOTS, effectToRemove);
    });

    // Adjust attacker ap if player
    if (!attacker.isMonster) {
        commandResult.withAdjustment(attackerName, AP, -ability.apCost);
    }

    return commandResult;
};

/**
 *
 * @param {*} attackerName
 * @param {*} defenderName
 * @param {*} ability
 * @param {*} context
 * @returns {CommandResult}
 */
const heal = (attackerName, defenderName, ability, context) => {
    if (ability.element !== 'HEALING') {
        throw `@${ability.name} is not a healing ability`;
    }

    let commandResult = CommandResult.create()
        .withAction(ability.name)
        .withActor(attackerName)
        .withTarget(defenderName);

    let attacker = getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    if (!attacker.isMonster && attacker.ap < ability.ap) {
        throw `@${attackerName} needs ${ability.ap} AP to use ${ability.name}.`;
    }

    let defender = getTarget(defenderName, context);

    let healingAmount = Math.max(1, rollDice(ability.dmg));
    if (ability.dmgStat.toLowerCase === 'hp') {
        let maxHeal = defender.maxHp - defender.hp;
        healingAmount = Math.min(maxHeal, healingAmount);
    }

    commandResult.withAdjustment(attackerName, AP, -ability.ap);
    commandResult.withAdjustment(
        defenderName,
        ability.dmgStat.toLowerCase(),
        healingAmount
    );
    commandResult.withMessage(
        `${ability.name} healed ${defender.name} for ${healingAmount} ${ability.dmgStat}`
    );

    return commandResult;
};

/**
 *
 * @param {*} attackerName
 * @param {*} defenderName
 * @param {*} context
 * @returns {CommandResult}
 */
export const attack = (attackerName, defenderName, context) => {
    let attacker = getTarget(attackerName, context);

    let weapon = attacker.equipment.hand;

    // If no weapon equipped, fill an empty object
    if (!weapon) {
        weapon = {
            name: 'Bare Hands',
            dmg: '1',
            dmgStat: 'hp',
            toHitStat: 'hit',
            triggers: [],
        };
    }

    let result = hurt(
        attackerName,
        defenderName,
        {
            name: 'attack',
            dmg: weapon.dmg,
            dmgStat: weapon.dmgStat,
            toHitStat: weapon.toHitStat,
            ap: 1,
            ignoreDamageMods: false,
            target: 'ANY',
            area: 'ONE',
            triggers: weapon.triggers,
            element: 'NONE',
            mods: {
                hit: 0,
                str: 0,
            },
        },
        context
    );

    return [result];
};

/**
 *
 * @param {*} attackerName
 * @param {*} defenderName
 * @param {*} ability
 * @param {*} context
 * @returns {[CommandResult]}
 */
export const useAbility = (attackerName, defenderName, ability, context) => {
    let encounterTable = context.encounterTable;
    let targets = Object.keys(context.players);
    let aliveMonsters = Object.keys(encounterTable).map(
        (monster) => '~' + monster
    );

    let attacker = getTarget(attackerName, context);

    if (!ability) {
        throw `Ability named ${ability.name} doesn't exist.`;
    }

    // Temporary patch until values are changed in UI and DB.
    if (ability.target === 'CHAT') {
        ability.target = 'FRIENDLY';
    }

    // TODO Determine if target is valid

    // Determine if command syntax is valid given the ability area.
    let abilityTargets = [];
    if (!defenderName) {
        if (ability.area === 'ONE' && ability.target !== 'FRIENDLY') {
            throw `${ability.name} cannot target all opponents.  You must specify a target.`;
        } else if (ability.area === 'ONE' && ability.target === 'FRIENDLY') {
            abilityTargets = [attackerName];
        } else if (ability.area == 'ALL' && ability.target === 'ENEMY') {
            if (!attacker.isMonster) {
                abilityTargets = aliveMonsters;
            } else {
                abilityTargets = targets;
            }
        } else if (ability.area == 'ALL' && ability.target === 'FRIENDLY') {
            if (!attacker.isMonster) {
                abilityTargets = targets;
            } else {
                abilityTargets = aliveMonsters;
            }
        } else {
            abilityTargets = [...targets, ...aliveMonsters];
        }
    } else {
        if (ability.area === 'ALL') {
            throw `${ability.name} cannot target just one opponent.`;
        }

        abilityTargets = [defenderName];
    }

    // Perform ability on everyone
    let results = [];
    for (let i in abilityTargets) {
        let abilityTarget = abilityTargets[i];

        if (ability.element === 'HEALING') {
            results.push(heal(attackerName, abilityTarget, ability, context));
        } else if (ability.element === 'BUFFING') {
            results.push(buff(attackerName, abilityTarget, ability, context));
        } else if (ability.element === 'CLEANSING') {
            results.push(
                cleanse(attackerName, abilityTarget, ability, context)
            );
        } else {
            results.push(hurt(attackerName, abilityTarget, ability, context));
        }
    }

    return results;
};

export const spawnMonster = (monsterName, personalName, context) => {
    // Retrieve monster from monster table
    let monsterCopy = context.monsterTable[monsterName.toUpperCase()];

    if (!monsterCopy) {
        throw `${monsterName} is not a valid monster`;
    }

    // Make deep copy
    let monster = { ...monsterCopy };
    monster.drops = monsterCopy.drops
        .filter((drop) => {
            return !drop.exclusiveTaken;
        })
        .map((drop) => {
            return { ...drop };
        });
    monster.actions = monsterCopy.actions.map((action) => {
        return { ...action };
    });

    console.log('SPAWNED: ' + JSON.stringify(monster, null, 5));

    // Set type here temporarily until we add to DB
    let type = monster.type || 'MOB';
    let abbrev = '';
    switch (type) {
        case 'MOB':
            abbrev = 'M';
            break;
        case 'ELITE':
            abbrev = 'E';
            break;
        case 'BOSS':
            abbrev = 'B';
            break;
        case 'RARE':
            abbrev = 'R';
            break;
    }

    // Pick either the provided name or the default name
    var name = personalName || monster.name;

    // Copy monster into it's own object
    var index = 0;
    while (context.encounterTable[abbrev + ++index]);
    let spawn = {
        ...monster,
        aggro: {},
        name,
        spawnKey: abbrev + index,
        maxHp: monster.hp,
        actionCooldown: Math.min(11, 6 - Math.min(5, monster.dex)),
    };

    return spawn;
};
