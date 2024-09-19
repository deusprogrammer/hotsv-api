import axios from 'axios';
import { indexArrayToMap, expandUser } from '../utils.js';

export default class CBDClient {
    constructor(url, jwtToken) {
        this.url = url;
        this.jwtToken = jwtToken;
        this.isLoaded = false;
    }

    loadGameData = async () => {
        this.abilityTable = await this.getAbilityTable();
        this.jobTable = await this.getJobTable();
        this.itemTable = await this.getItemTable();
        this.monsterTable = await this.getMonsterTable();
        this.isLoaded = true;
    }

    getGameContext = async () => {
        if (!this.isLoaded) {
            await this.loadGameData();
        }

        return {
            abilityTable: this.abilityTable,
            jobTable: this.jobTable,
            itemTable: this.itemTable,
            monsterTable: this.monsterTable
        }
    }

    getCharacter = async (characterId) => {
        const {data: character} = await axios.get(`${this.url}/users/${characterId}`, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`
            }
        });

        return expandUser(character, await this.getGameContext());
    };

    giveItemToCharacter = async (characterId, itemId) => {
        await axios.post(`${this.url}/users/${characterId}/changes`, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`
             }
         }, [
            {
                type: 'give',
                id: itemId
            }
         ]);
    };

    getMonster = async (monsterId) => {
        const {data: monster} = await axios.get(`${this.url}/monsters/${monsterId}`, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`
            }
        });

        return monster;
    };

    getItemTable = async () => {
        console.log("GETTING ITEM TABLE");
        const {data: items} = await axios.get(`${this.url}/items`, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`
            }
        });
        console.log("ITEMS: " + JSON.stringify(items, null, 5));
        return indexArrayToMap(items);
    }
    
    getJobTable = async () => {
        console.log("GETTING JOB TABLE");
        const {data: jobs} = await axios.get(`${this.url}/jobs`, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`
            }
        });
        console.log("JOBS: " + JSON.stringify(jobs, null, 5));
        return indexArrayToMap(jobs);
    }
    
    getMonsterTable = async () => {
        console.log("GETTING MONSTER TABLE");
        const {data: monsters} = await axios.get(`${this.url}/monsters`, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`
            }
        });
        console.log("MONSTERS: " + JSON.stringify(monsters, null, 5));
        return indexArrayToMap(monsters);
    }
    
    getAbilityTable = async () => {
        console.log("GETTING ABILITY TABLE");
        const {data: abilities} = await axios.get(`${this.url}/abilities`, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`
            }
        });
        console.log("ABILITIES: " + JSON.stringify(abilities, null, 5));
        return indexArrayToMap(abilities);
    }
}