// systems.js
// This file contains the core "engine" of the game. It's pure, non-visual logic.
// It handles all the mathematical calculations for stats, combat, and loot.

// Import the data definitions from our GDD file
import { races, items, progression, gddConstants } from './gdd.js';

// Export the entire Systems object so other files can use its functions
export const Systems = {
    /**
     * Calculates all of a player's derived combat stats based on their base stats, race, and equipment.
     * This is the "brain" of character power.
     * @param {object} player - The full player object.
     * @returns {object} The player object with an updated `derivedStats` property.
     */
    calculateDerivedStats(player) {
        player.derivedStats = {};
        const racialData = races[player.race];
        if (!racialData) {
            console.error(`Invalid race specified in calculateDerivedStats: ${player.race}`);
            return player;
        }

        let totalGearAC = 0;
        let totalGearWC = 0;
        let totalGearSC = 0;
        let bonusHitChance = 0;
        let bonusWcScMultiplier = 1.0;

        for (const slotName in player.equipment) {
            const instanceId = player.equipment[slotName];
            if (!instanceId) continue;

            const item = player.inventory.find(i => i.instanceId === instanceId);
            if (!item) continue;
            
            const baseItem = items.baseItemTemplates.find(b => b.id === item.baseItemId);
            if (!baseItem) continue;

            const slotData = progression.dropperSlotModifiers[baseItem.subType] || {};
            const tierData = progression.dropperTiers.find(t => t.tier === item.tier);
            if (!tierData) continue;

            const itemStatValue = tierData.classValue * (slotData.statProportionality || 0);

            if (slotData.statType === 'AC') totalGearAC += itemStatValue;
            if (slotData.statType === 'WC') totalGearWC += itemStatValue;
            if (slotData.statType === 'SC') totalGearSC += itemStatValue;
            
            if (slotData.specialBonus) {
                if (slotData.specialBonus.stat === 'Hit Chance') bonusHitChance += slotData.specialBonus.value;
                if (slotData.specialBonus.stat === 'WC/SC') bonusWcScMultiplier += slotData.specialBonus.value;
            }
        }

        let finalWC = 0;
        let finalSC = 0;
        
        // Determine the primary scaling stat based on race/archetype
        const primaryStatKey = racialData.primaryStat.toUpperCase(); // DEX, WIS, or VIT
        const scalingStatValue = player.baseStats[primaryStatKey] || 0;

        switch (racialData.archetype) {
            case 'True Fighter':
                const fighterScalingStat = racialData.specialCase ? (player.baseStats.VIT || 0) : scalingStatValue;
                finalWC = totalGearWC * (1 + (fighterScalingStat * 0.0055));
                break;
            case 'True Caster':
                const casterScalingStat = racialData.specialCase ? (player.baseStats.VIT || 0) : scalingStatValue;
                finalSC = totalGearSC * (1 + (casterScalingStat * 0.0055));
                break;
            case 'Hybrid':
                finalWC = totalGearWC * (1 + (scalingStatValue * 0.0055));
                finalSC = totalGearSC * (1 + (scalingStatValue * 0.0055));
                break;
        }
        
        finalWC *= bonusWcScMultiplier;
        finalSC *= bonusWcScMultiplier;
        
        player.derivedStats.maxHp = 100 + ((player.baseStats.VIT || 0) * 10);
        player.derivedStats.AC = totalGearAC * (1 + ((player.baseStats.VIT || 0) * 0.0075));
        player.derivedStats.WC = finalWC;
        player.derivedStats.SC = finalSC;
        
        if (['DEX', 'VIT'].includes(primaryStatKey)) { // Covers Fighters, Martial Hybrids, and Trolls
            player.derivedStats.hitChance = 90 + ((player.baseStats.DEX || 0) * 0.05);
            player.derivedStats.critChance = 5 + ((player.baseStats.DEX || 0) * 0.01);
        } else { // Covers Casters, Mystic Hybrids, and Vampires
            player.derivedStats.hitChance = 90 + ((player.baseStats.WIS || 0) * 0.05);
            player.derivedStats.critChance = 5 + ((player.baseStats.WIS || 0) * 0.01);
        }
        
        player.derivedStats.hitChance += (player.derivedStats.hitChance * bonusHitChance);
        
        // Ensure HP is correctly set after stat calculation
        if (player.hp === undefined || player.hp > player.derivedStats.maxHp) {
            player.hp = player.derivedStats.maxHp;
        }

        player.stats = player.derivedStats; // For backward compatibility if needed
        return player;
    },

    /**
     * Scales a monster's base stats up to a target gear tier.
     * @param {object} monster - The base monster object from the bestiary.
     * @param {number} targetGearTier - The gear tier of the zone.
     * @returns {object} A new monster object with scaled stats.
     */
    MonsterScaling(monster, targetGearTier) {
        const scaledMonster = { ...monster };
        if (targetGearTier <= 1) return scaledMonster;
        
        const tierDiff = targetGearTier - 1;
        scaledMonster.hp *= Math.pow(gddConstants.MONSTER_SCALING_HP_RATE, tierDiff);
        scaledMonster.atk *= Math.pow(gddConstants.MONSTER_SCALING_ATK_RATE, tierDiff);
        scaledMonster.def *= Math.pow(gddConstants.MONSTER_SCALING_DEF_RATE, tierDiff);
        scaledMonster.xp *= Math.pow(gddConstants.MONSTER_SCALING_REWARD_RATE, tierDiff);
        scaledMonster.gold *= Math.pow(gddConstants.MONSTER_SCALING_REWARD_RATE, tierDiff);
        
        return scaledMonster;
    },

    /**
     * Resolves a single turn of combat between the player and a monster.
     * @param {object} player - The full player object.
     * @param {object} monster - The monster object (must have a `currentHP` property).
     * @returns {object} An object describing the outcome of the turn.
     */
    resolveCombatTurn(player, monster) {
        const racialData = races[player.race];
        let playerDamage = 0;
        const playerStats = player.derivedStats;
        const monsterAC = monster.def;

        if (racialData.archetype === 'Hybrid') {
            const wcDamage = (gddConstants.PLAYER_DAMAGE_CONSTANT * playerStats.WC) / monsterAC;
            const scDamage = (gddConstants.PLAYER_DAMAGE_CONSTANT * playerStats.SC) / monsterAC;
            playerDamage = (wcDamage + scDamage) * gddConstants.HYBRID_SPELLSTRIKE_MULTIPLIER;
        } else if (racialData.archetype === 'True Fighter') {
            playerDamage = (gddConstants.PLAYER_DAMAGE_CONSTANT * playerStats.WC) / monsterAC;
        } else if (racialData.archetype === 'True Caster') {
            playerDamage = (gddConstants.PLAYER_DAMAGE_CONSTANT * playerStats.SC) / monsterAC;
        }
        
        monster.currentHP -= playerDamage;
        if (monster.currentHP <= 0) {
            monster.currentHP = 0;
            return { status: 'VICTORY', player, monster, damageDealt: playerDamage, damageTaken: 0 };
        }
        
        let monsterDamage = monster.atk - (playerStats.AC * gddConstants.MONSTER_DAMAGE_AC_REDUCTION_FACTOR);
        monsterDamage = Math.max(0, monsterDamage);
        
        player.hp -= monsterDamage;
        if (player.hp <= 0) {
            player.hp = 0;
            return { status: 'DEFEAT', player, monster, damageDealt: playerDamage, damageTaken: monsterDamage };
        }
        
        return { status: 'CONTINUE', player, monster, damageDealt: playerDamage, damageTaken: monsterDamage };
    },

    /**
     * Simulates an entire combat encounter and returns the final result and log.
     * @param {object} player - The full player object.
     * @param {object} monster - The base monster object.
     * @returns {object} An object with the outcome, final state, and a log array.
     */
    simulateCombat(player, monster) {
        let simPlayer = JSON.parse(JSON.stringify(player));
        let simMonster = JSON.parse(JSON.stringify(monster));
        simMonster.currentHP = simMonster.hp;

        const combatLog = [`Combat Start: ${simPlayer.name} vs. ${simMonster.name}`];
        let turn = 1;
        let result = {};

        while (turn <= 100) { // Safety break after 100 turns
            result = this.resolveCombatTurn(simPlayer, simMonster);
            
            combatLog.push(`Turn ${turn}: ${simPlayer.name} deals ${result.damageDealt.toFixed(2)} damage. [Monster HP: ${simMonster.currentHP.toFixed(2)}]`);
            if (result.status === 'VICTORY') {
                combatLog.push(`${simMonster.name} has been defeated!`);
                break;
            }

            combatLog.push(`Turn ${turn}: ${simMonster.name} deals ${result.damageTaken.toFixed(2)} damage. [Player HP: ${simPlayer.hp.toFixed(2)}]`);
            if (result.status === 'DEFEAT') {
                combatLog.push(`${simPlayer.name} has been defeated!`);
                break;
            }
            
            turn++;
        }
        
        if (turn > 100) {
            combatLog.push('Combat exceeded 100 turns. Halting simulation.');
            result.status = 'STALEMATE';
        }

        return {
            outcome: result.status,
            finalState: { player: simPlayer, monster: simMonster },
            log: combatLog
        };
    },

    /**
     * Generates loot after a successful combat.
     * @param {object} player - The player object to add loot to.
     * @param {object} monster - The defeated monster.
     * @param {string} currentZoneId - The ID of the current zone.
     * @returns {string[]} An array of loot messages for the log.
     */
    generateLoot(player, monster, currentZoneId) {
        const lootMessages = [];
        
        player.gold += monster.gold;
        player.xp += monster.xp;
        
        lootMessages.push(`You earned <span class="log-xp">${Math.floor(monster.xp)} XP</span> and <span class="log-gold">${Math.floor(monster.gold)} Gold</span>!`);
        
        // Gem Drop Logic
        if (Math.random() < gddConstants.BASE_GEM_DROP_CHANCE) {
            const zoneTierInfo = progression.gemGradeTiers.find(g => g.correspondingZone.includes(currentZoneId));
            const gemGradeTier = zoneTierInfo ? zoneTierInfo.gradeTier : 1;
            
            const allStandardGems = Object.values(gems.standard);
            const randomGemTemplate = allStandardGems[Math.floor(Math.random() * allStandardGems.length)];
            
            const newGem = { id: randomGemTemplate.id, grade: gemGradeTier };
            player.gems.push(newGem);
            
            lootMessages.push(`You found a new gem: <span class="log-loot-gem">${randomGemTemplate.name} (Grade ${newGem.grade})</span>!`);
        }
        
        // Shadow & Echo Drop Logic
        if (Math.random() < gddConstants.BASE_SHADOW_DROP_CHANCE) {
            const equippedDroppers = Object.values(player.equipment)
                .map(instanceId => player.inventory.find(i => i.instanceId === instanceId))
                .filter(item => item && item.type === 'Dropper');

            if (equippedDroppers.length > 0) {
                const randomEquippedItem = equippedDroppers[Math.floor(Math.random() * equippedDroppers.length)];
                
                const existingShadow = player.inventory.find(i => i.baseItemId === randomEquippedItem.baseItemId && i.type === 'Shadow');
                
                let newItem;
                if (existingShadow) {
                    newItem = { ...randomEquippedItem, instanceId: `echo_${Date.now()}`, type: 'Echo', qualityMultiplier: gddConstants.ECHO_QM };
                    const baseItemName = items.baseItemTemplates.find(b => b.id === newItem.baseItemId).name;
                    lootMessages.push(`A faint <span class="log-loot-item">Echo</span> of your ${baseItemName} appears!`);
                } else {
                    const randomQM = gddConstants.SHADOW_QM_MIN + (Math.random() * (gddConstants.SHADOW_QM_MAX - gddConstants.SHADOW_QM_MIN));
                    newItem = { ...randomEquippedItem, instanceId: `shadow_${Date.now()}`, type: 'Shadow', qualityMultiplier: randomQM };
                    const baseItemName = items.baseItemTemplates.find(b => b.id === newItem.baseItemId).name;
                    lootMessages.push(`The shadow of your <span class="log-loot-item">${baseItemName}</span> solidifies! (QM: ${newItem.qualityMultiplier.toFixed(2)})`);
                }
                player.inventory.push(newItem);
            }
        }
        
        return lootMessages;
    }
};

