import crypto from 'crypto';
import {rando} from '@nastyox/rando.js';

export const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export const indexArrayToMap = (array) => {
    let table = {};
    array.forEach((element) => {
        table[element.id] = element;
    });

    return table;
}

export const nthIndex = (str, pat, n) => {
    var L = str.length, i = -1;
    while (n-- && i++ < L) {
        i = str.indexOf(pat, i);
        if (i < 0) break;
    }
    return i + 1;
}

export const randomUuid = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export const randomNumber = (max) => {
    return Math.floor(Math.random() * Math.floor(max)) + 1;
}

export const rollDice = (dice, of) => {
    let tokens = dice.split("d");

    // If it's just a hard coded number, just return the number
    if (tokens.length === 1) {
        if (tokens[0].endsWith("%")) {
            let percent = parseInt(tokens[0].substring(0, tokens[0].length - 1));
            return Math.ceil(percent/100 * of);
        }
        return parseInt(tokens[0]);
    }

    // Otherwise roll dice
    let total = 0;
    for (var i = 0; i < parseInt(tokens[0]); i++) {
        total += rando(1, parseInt(tokens[1]));
        //total += Math.floor(Math.random() * Math.floor(parseInt(tokens[1]))) + 1;
    }
    return total;
}

export const sign = (number) => {
    if (number >= 0) {
        return `+${number}`;
    }
    return `${number}`;
}

export const expandUser = (userData, context) => {
    // console.log("USER: " + JSON.stringify(userData, null, 5));
    // console.log("CONTEXT: " + JSON.stringify(context, null, 5));

    userData.totalAC = 0;
    userData.currentJob = context.jobTable[userData.currentJob.id];
    userData.str = userData.currentJob.str;
    userData.dex = userData.currentJob.dex;
    userData.int = userData.currentJob.int;
    userData.hit = userData.currentJob.hit;
    userData.maxHp = userData.currentJob.hp;
    userData.abilities = {};
    userData.resistances = {};
    userData.unlocks = [];
    Object.keys(userData.equipment).forEach((slot) => {
        let item = userData.equipment[slot];
        let itemData = context.itemTable[item.id];
        if (itemData.type === "armor") {
            userData.totalAC += itemData.ac;
        }
        userData.totalAC += itemData.mods.ac;
        userData.maxHp += itemData.mods.hp;
        userData.str += itemData.mods.str;
        userData.dex += itemData.mods.dex;
        userData.int += itemData.mods.int;
        userData.hit += itemData.mods.hit;

        userData.resistances.fire       += itemData.resistances.fire;
        userData.resistances.ice        += itemData.resistances.ice;
        userData.resistances.lightning  += itemData.resistances.lightning;
        userData.resistances.water      += itemData.resistances.water;
        userData.resistances.earth      += itemData.resistances.earth;
        userData.resistances.light      += itemData.resistances.light;
        userData.resistances.dark       += itemData.resistances.dark;

        itemData.unlocks.forEach((unlock) => {
            userData.unlocks.push(unlock);
        });

        itemData.abilities.forEach((abilityId) => {
            userData.abilities[abilityId] = context.abilityTable[abilityId];
        });
        userData.equipment[slot] = itemData;
    });
    let newInventoryList = [];
    userData.inventory.forEach((item) => {
        newInventoryList.push(context.itemTable[item]);
    });

    if (userData.maxHp < 0) {
        userData.maxHp = 1;
    }

    // if (userData.hp > userData.maxHp) {
    //     userData.hp = userData.maxHp;
    // }

    userData.inventory = newInventoryList;
    userData.actionCooldown = Math.min(11, 6 - Math.min(5, userData.dex));

    return userData;
}

export const hmacSHA1 = (hmacSecret, data) => {
    return crypto.createHmac('sha1', hmacSecret).update(data).digest().toString('base64');
}