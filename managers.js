// managers.js
// This file contains all the "Manager" objects. Each manager is responsible for
// controlling a specific part of the game's UI and handling user interactions.
// It acts as the bridge between the player's clicks and the core game engine (systems.js).

import { Systems } from './systems.js';
import { races, items, progression, gddConstants, equipmentSlotConfig, bestiary, embeddedZoneData, gems } from './gdd.js';

// --- Global State & UI References ---
let state = {};
let ui = {};

// This function will be called from main.js to give the managers access to the app's state and UI elements.
export function initializeManagers(appState, uiElements) {
    state = appState;
    ui = uiElements;
}

// --- AuthManager: Handles Login and Account Creation Logic ---
export const AuthManager = {
    async login(email, password) {
        try {
            await window.firebase.signInWithEmailAndPassword(state.firebase.auth, email, password);
        } catch (error) {
            showToast(error.message, true);
            console.error("Login Error:", error);
        }
    },

    async createAccount(email, password, playerName, raceId) {
        try {
            const { createUserWithEmailAndPassword, doc } = window.firebase;
            const userCredential = await createUserWithEmailAndPassword(state.firebase.auth, email, password);
            const user = userCredential.user;
            state.firebase.userId = user.uid;
            
            const appId = 'geminus-gog';
            state.firebase.playerDocRef = doc(state.firebase.db, 'artifacts', appId, 'users', user.uid, 'playerData', 'main');

            const raceData = races[raceId];
            if (!raceData) throw new Error("Invalid race selected.");

            const newPlayer = {
                name: playerName,
                level: 1, xp: 0, gold: 1000,
                xpToNextLevel: gddConstants.XP_BASE,
                attributePoints: gddConstants.AP_PER_LEVEL,
                race: raceId,
                archetype: raceData.archetype,
                cci: raceData.coreCombatIdentity,
                baseStats: { STR:0, DEX:0, VIT:0, NTL:0, WIS:0, ...raceData.apAllocationWeights },
                inventory: [],
                equipment: {},
                gems: [],
                lastItemDrop: null,
                lastGemDrop: null,
                defeatedBosses: [],
                pos: { x: 12, y: 12 },
                icon: '👤'
            };

            const startingWeaponTemplate = items.baseItemTemplates.find(i => i.subType === 'Sword');
            const startingArmorTemplate = items.baseItemTemplates.find(i => i.subType === 'Armor');

            if (startingWeaponTemplate && startingArmorTemplate) {
                const newWeapon = { instanceId: `wep_${Date.now()}`, baseItemId: startingWeaponTemplate.id, tier: 1, type: 'Dropper', socketedGems: [] };
                const newArmor = { instanceId: `arm_${Date.now()}`, baseItemId: startingArmorTemplate.id, tier: 1, type: 'Dropper', socketedGems: [] };
                newPlayer.inventory.push(newWeapon, newArmor);
                newPlayer.equipment = { 'Weapon 1': newWeapon.instanceId, 'Armor': newArmor.instanceId };
            }
            
            state.player = Systems.calculateDerivedStats(newPlayer);
            state.player.hp = state.player.derivedStats.maxHp;

            await DataManager.savePlayer(newPlayer);
        } catch (error) {
            showToast(error.message, true);
            console.error("Create Account Error:", error);
        }
    },
};

// --- DataManager: Handles all interactions with Firebase Firestore ---
export const DataManager = {
    async savePlayer(playerData) {
        if (!state.firebase.playerDocRef) return;
        try {
            const { setDoc, serverTimestamp } = window.firebase;
            const dataToSave = {
                ...playerData,
                inventory: JSON.stringify(playerData.inventory),
                equipment: JSON.stringify(playerData.equipment),
                gems: JSON.stringify(playerData.gems),
                lastSaved: serverTimestamp()
            };
            await setDoc(state.firebase.playerDocRef, dataToSave, { merge: true });
        } catch (error) {
            showToast("Failed to save character progress.", true);
            console.error("Save Error:", error);
        }
    },

    async updatePlayer(fieldsToUpdate) {
        if (!state.firebase.playerDocRef) return;
        try {
            const { updateDoc, serverTimestamp } = window.firebase;
            const updates = { ...fieldsToUpdate };
            for (const key in updates) {
                if (typeof updates[key] === 'object' && updates[key] !== null) {
                    updates[key] = JSON.stringify(updates[key]);
                }
            }
            updates.lastSaved = serverTimestamp();
            await updateDoc(state.firebase.playerDocRef, updates);
        } catch (error) {
            console.error("Update Error:", error);
            if (error.code === 'not-found') {
                await this.savePlayer(state.player);
            }
        }
    }
};

// --- UIManager: Handles general UI updates and player status ---
export const UIManager = {
    updatePlayerStatusUI() {
        if (!state.player) return;
        const p = state.player;
        const raceData = races[p.race];
        const archetypeAbbr = { 'True Fighter': 'FTR', 'True Caster': 'CST', 'Hybrid': 'HYB' }[p.archetype] || 'N/A';
        const cciParts = (p.cci || 'N/A').split('/');
        const specialization = cciParts[0] === cciParts[1] ? cciParts[0] : p.cci;
        const aspecValue = `${archetypeAbbr}-${specialization}`;
        ui.playerNameLevelValue.textContent = `${p.name} Lvl: ${p.level}`;
        ui.playerRaceValue.textContent = raceData ? raceData.raceName : p.race;
        ui.playerAspecValue.textContent = aspecValue;
        ui.zoneNameValue.textContent = state.zone.name;
        ui.playerCoordsValue.textContent = `(${p.pos.x},${p.pos.y})`;
    },

    flashStatUpdate(attr) {
        const statValueEl = document.querySelector(`[data-stat-value="${attr}"]`);
        const unspentPointsEl = document.getElementById('unspent-points-value');
        if (statValueEl) { statValueEl.classList.add('flash-update'); setTimeout(() => statValueEl.classList.remove('flash-update'), 500); }
        if (unspentPointsEl) { unspentPointsEl.classList.add('flash-update'); setTimeout(() => unspentPointsEl.classList.remove('flash-update'), 500); }
    }
};

export const ProfileManager = {
    addXp(amount) {
        if (!state.player) return;
        state.player.xp += amount;
        CombatManager.logToGame(`You gained <span class="log-xp">${Math.floor(amount)} XP</span>!`);
        while (state.player.xp >= state.player.xpToNextLevel) {
            this.levelUp();
        }
        this.updateAllProfileUI();
        DataManager.updatePlayer({ xp: state.player.xp, level: state.player.level, xpToNextLevel: state.player.xpToNextLevel, attributePoints: state.player.attributePoints });
    },
    addGold(amount) {
        if (!state.player) return;
        state.player.gold += amount;
        CombatManager.logToGame(`You found <span class="log-gold">${Math.floor(amount)} Gold</span>!`);
        this.updateAllProfileUI();
        DataManager.updatePlayer({ gold: state.player.gold });
    },
    levelUp() {
        state.player.xp -= state.player.xpToNextLevel;
        state.player.level++;
        state.player.xpToNextLevel = Math.floor(gddConstants.XP_BASE * Math.pow(gddConstants.XP_GROWTH_RATE, state.player.level));
        state.player.attributePoints += gddConstants.AP_PER_LEVEL;
        showToast(`You have reached Level ${state.player.level}! You gained ${gddConstants.AP_PER_LEVEL} Attribute Points.`);
        Systems.calculateDerivedStats(state.player);
        state.player.hp = state.player.derivedStats.maxHp;
    },
    spendAttributePoint(clickedAttr) {
        const p = state.player;
        if (p.attributePoints < gddConstants.AP_PER_LEVEL) {
            showToast(`You need ${gddConstants.AP_PER_LEVEL} points to allocate.`, true);
            return;
        }
        const racialData = races[p.race];
        const weights = racialData.apAllocationWeights;
        const totalWeight = Object.values(weights).reduce((sum, val) => sum + val, 0);
        const pointsPerWeight = gddConstants.AP_PER_LEVEL / totalWeight;
        for (const stat in weights) {
            p.baseStats[stat.toUpperCase()] += weights[stat] * pointsPerWeight;
        }
        p.attributePoints -= gddConstants.AP_PER_LEVEL;
        Systems.calculateDerivedStats(state.player);
        StatsManager.render();
        UIManager.flashStatUpdate(clickedAttr);
        showToast("Attributes increased!", false);
        DataManager.updatePlayer({ baseStats: p.baseStats, attributePoints: p.attributePoints });
    },
    updateAllProfileUI() {
        UIManager.updatePlayerStatusUI();
        if (CombatManager.isInitialized) CombatManager.updateCombatInfoPanel();
        if (StatsManager.isInitialized) StatsManager.render();
    }
};

export const CombatManager = {
    isInitialized: false,
    currentMonster: null,
    logMessages: [],
    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        this.render();
        this.addEventListeners();
        this.updateCombatInfoPanel();
        this.populateMonsterList(state.game.currentZoneId);
        this.logMessages = ['Select a monster to begin combat.'];
        this.renderLog();
    },
    logToGame(message) {
        this.logMessages.push(message);
        if (this.logMessages.length > 5) {
            this.logMessages.shift();
        }
        this.renderLog();
    },
    renderLog() {
        const logDisplay = document.querySelector('#tab-content-combat #combat-log-display');
        if (logDisplay) {
            logDisplay.innerHTML = this.logMessages.join('<br>');
            logDisplay.scrollTop = logDisplay.scrollHeight;
        }
    },
    render() {
        ui.tabContentCombat.innerHTML = `
        <div class="space-y-4 flex flex-col h-full">
            <div id="combat-info-panel" class="w-full p-2 rounded-lg bg-black/20 border" style="border-color: var(--border-color-main)"><div id="combat-stats-container"></div></div>
            <div class="combat-control-bar flex gap-2 p-2 bg-black/20 rounded-lg">
                <select id="monsterSelect" class="editor-input flex-grow"></select>
                <button class="glass-button px-4 py-2" id="fightBtn">FIGHT</button>
            </div>
            <div class="flex justify-center gap-2">
                <button class="glass-button py-2 rounded-md w-1/2" id="attackBtn" style="display: none;">ATTACK</button>
                <button class="glass-button py-2 rounded-md w-1/2" id="castBtn" style="display: none;">CAST</button>
                <button class="glass-button py-2 rounded-md w-1/2" id="spellstrikeBtn" style="display: none;">SPELLSTRIKE</button>
            </div>
            <div id="combat-log-display" class="flex-grow p-2 overflow-y-auto custom-scrollbar text-sm"></div>
        </div>`;
    },
    updateCombatInfoPanel() {
        const p = state.player;
        if (!p || !p.derivedStats) return;
        const hpPercent = (p.hp / p.derivedStats.maxHp) * 100;
        let healthClass = hpPercent < 20 ? 'text-red-500' : hpPercent < 50 ? 'text-yellow-500' : 'text-green-500';
        const createStatHTML = (label, value) => `<span class="text-glow-label">${label}:</span><span class="text-glow-subtle">${value}</span>`;
        document.getElementById('combat-stats-container').innerHTML = `
            ${createStatHTML('Level', p.level)}
            ${createStatHTML('Inv/Bags', `${p.inventory.length}/200`)}
            ${createStatHTML('Health', `<span class="${healthClass}">${Math.ceil(p.hp)} / ${Math.ceil(p.derivedStats.maxHp)}</span>`)}
            ${createStatHTML('Gem Pouch', `${p.gems.length}/${InventoryManager.MAX_GEMS}`)}
            ${createStatHTML('Gold', Math.floor(p.gold).toLocaleString())}
            ${createStatHTML('Last Item', p.lastItemDrop || 'None')}
            ${createStatHTML('XP', Math.floor(p.xp).toLocaleString())}
            ${createStatHTML('Last Gem', p.lastGemDrop || 'None')}
            ${createStatHTML('Next Lvl', Math.floor(p.xpToNextLevel).toLocaleString())}
            <div class="col-span-4 text-glow-subtle text-center mt-1">Location: ${state.zone.name}</div>
        `;
    },
    addEventListeners() {
        const combatTab = ui.tabContentCombat;
        combatTab.querySelector('#monsterSelect').addEventListener('change', (e) => this.selectMonster(e.target.value));
        combatTab.querySelector('#fightBtn').addEventListener('click', () => this.fight());
        combatTab.querySelector('#attackBtn').addEventListener('click', () => this.performAction('attack'));
        combatTab.querySelector('#castBtn').addEventListener('click', () => this.performAction('cast'));
        combatTab.querySelector('#spellstrikeBtn').addEventListener('click', () => this.performAction('spellstrike'));
    },
    populateMonsterList(zoneId) {
        state.game.currentZoneId = zoneId;
        const zoneData = bestiary[zoneId];
        if (!zoneData) return;
        const monsterSelect = document.getElementById('monsterSelect');
        let optionsHTML = '<option value="">Select a monster...</option>';
        zoneData.monsters.forEach(m => optionsHTML += `<option value="${m.id}">${m.name}</option>`);
        monsterSelect.innerHTML = optionsHTML;
        this.resetCombatSelection();
    },
    selectMonster(monsterId) {
        if (!monsterId) { this.resetCombatSelection(); return; }
        const zoneData = bestiary[state.game.currentZoneId];
        const monsterTemplate = zoneData.monsters.find(m => m.id === monsterId);
        if (!monsterTemplate) return;
        const scaledMonster = Systems.MonsterScaling(monsterTemplate, zoneData.gearTier);
        this.currentMonster = { ...scaledMonster, currentHP: scaledMonster.hp, stats: {ATK: scaledMonster.atk, DEF: scaledMonster.def, HP: scaledMonster.hp, XP: scaledMonster.xp, GOLD: scaledMonster.gold} };
        this.logMessages = [`You are targeting ${this.currentMonster.name}.`];
        this.renderLog();
        this.updateButtons();
    },
    fight() {
        if (!this.currentMonster) return showToast("Please select a monster first.", true);
        state.game.combatActive = true;
        this.currentMonster.currentHP = this.currentMonster.hp;
        this.logMessages = [`You engage the ${this.currentMonster.name}!`];
        this.renderLog();
        this.updateButtons();
        const result = Systems.simulateCombat(state.player, this.currentMonster);
        this.logMessages.push(...result.log);
        if (result.outcome === 'VICTORY') {
            const lootMessages = Systems.generateLoot(state.player, result.finalState.monster, state.game.currentZoneId);
            this.logMessages.push(...lootMessages);
            ProfileManager.updateAllProfileUI();
            DataManager.updatePlayer(state.player);
        } else if (result.outcome === 'DEFEAT') {
            SanctuaryManager.handlePlayerDefeat();
        }
        this.endCombat();
    },
    performAction(actionType) {
        if (!state.game.combatActive || !this.currentMonster) return;
        const p = state.player;
        const enemy = this.currentMonster;
        const result = Systems.resolveCombatTurn(p, enemy);
        if (result.damageDealt) {
            this.logToGame(`You hit ${enemy.name} for <span class="log-player">${result.damageDealt.toFixed(2)}</span> damage.`);
        }
        if (result.damageTaken) {
            this.logToGame(`${enemy.name} hits you for <span class="log-enemy">${result.damageTaken.toFixed(2)}</span> damage.`);
        }
        if (result.status === 'VICTORY') {
            this.logToGame(`<span class="log-enemy">${enemy.name} is dead, R.I.P.</span>`);
            const lootMessages = Systems.generateLoot(state.player, enemy, state.game.currentZoneId);
            this.logMessages.push(...lootMessages);
            this.endCombat();
            ProfileManager.updateAllProfileUI();
            DataManager.updatePlayer(state.player);
        } else if (result.status === 'DEFEAT') {
            this.logToGame(`<span class="log-enemy">You have been defeated!</span>`);
            this.endCombat();
            SanctuaryManager.handlePlayerDefeat();
        }
        ProfileManager.updateAllProfileUI();
    },
    endCombat() {
        state.game.combatActive = false;
        this.updateButtons();
    },
    resetCombatSelection() {
        this.currentMonster = null;
        state.game.combatActive = false;
        this.logMessages = ['Select a monster to begin combat.'];
        this.renderLog();
        this.updateButtons();
    },
    updateButtons() {
        const [fightBtn, attackBtn, castBtn, spellstrikeBtn] = ['fightBtn', 'attackBtn', 'castBtn', 'spellstrikeBtn'].map(id => document.getElementById(id));
        if(!fightBtn || !attackBtn || !castBtn || !spellstrikeBtn) return;
        fightBtn.style.display = 'block';
        fightBtn.disabled = !this.currentMonster || state.game.combatActive;
        const canAct = this.currentMonster && state.game.combatActive;
        attackBtn.style.display = (canAct && state.player.archetype === 'True Fighter') ? 'flex' : 'none';
        castBtn.style.display = (canAct && state.player.archetype === 'True Caster') ? 'flex' : 'none';
        spellstrikeBtn.style.display = (canAct && state.player.archetype === 'Hybrid') ? 'flex' : 'none';
    }
};

export const SanctuaryManager = {
    isPlayerDefeated: false,
    handlePlayerDefeat() {
        if (this.isPlayerDefeated) return;
        this.isPlayerDefeated = true;
        state.game.combatActive = false;
        const goldLost = state.player.gold;
        const xpLost = state.player.xp;
        state.player.gold = 0;
        state.player.xp = 0;
        CombatManager.logToGame("<span class='log-enemy'>You have been defeated!</span>");
        CombatManager.logToGame(`<span class='log-system'>You lost ${Math.floor(goldLost)} gold and ${Math.floor(xpLost)} XP.</span>`);
        this.showDefeatedUI();
        DataManager.updatePlayer({ hp: 0, gold: 0, xp: 0 });
    },
    revivePlayer() {
        if (!this.isPlayerDefeated) return;
        state.player.hp = state.player.derivedStats.maxHp;
        this.isPlayerDefeated = false;
        showToast("You have been revived at the Sanctuary.", false);
        this.hideDefeatedUI();
        ProfileManager.updateAllProfileUI();
        DataManager.updatePlayer({ hp: state.player.hp });
    },
    showDefeatedUI() {
        const overlay = document.createElement('div');
        overlay.id = 'defeat-overlay';
        overlay.style.cssText = 'position: fixed; inset: 0; background-color: rgba(0,0,0,0.7); z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center;';
        overlay.innerHTML = `
            <h1 class="font-orbitron text-4xl text-red-500 mb-4">YOU HAVE FALLEN</h1>
            <p class="text-gray-300 mb-8">Your echo is drawn back to the nearest sanctuary...</p>
            <button id="revive-btn" class="glass-button w-1/2 max-w-xs py-4 font-bold rounded-md text-lg">Return to Sanctuary</button>`;
        document.body.appendChild(overlay);
        document.getElementById('revive-btn').addEventListener('click', () => this.revivePlayer());
    },
    hideDefeatedUI() {
        const overlay = document.getElementById('defeat-overlay');
        if (overlay) {
            overlay.remove();
        }
    }
};

export const StatsManager = {
    isInitialized: false,
    statMetadata: {
        STR: { name: 'Strength', icon: '💪', description: 'A gatekeeper stat for physical weapons.' },
        DEX: { name: 'Dexterity', icon: '🏹', description: 'Primary stat for Fighters & Martial Hybrids. Governs Hit/Crit Chance and WC scaling.' },
        VIT: { name: 'Vitality', icon: '❤️', description: 'Primary survivability stat. Governs Max HP and AC scaling.' },
        NTL: { name: 'Intellect', icon: '🧠', description: 'A gatekeeper stat for spells.' },
        WIS: { name: 'Wisdom', icon: '🔮', description: 'Primary stat for Casters & Mystic Hybrids. Governs Hit/Crit Chance and SC scaling.' },
        finalWC: { name: 'Weapon Class', icon: '⚔️', description: 'Your total effectiveness with physical weapons.' },
        finalSC: { name: 'Spell Class', icon: '✨', description: 'Your total effectiveness with magic.' },
        finalAC: { name: 'Armor Class', icon: '🛡️', description: 'Your total damage reduction.' },
        maxHp: { name: 'Health Points', icon: '❤️', description: 'Your life force. If it reaches zero, you are defeated.' },
        hitChance: { name: 'Hit Chance', icon: '🎯', description: 'The probability of successfully landing an attack on an enemy.' },
        critChance: { name: 'Crit Chance', icon: '💥', description: 'The probability of an attack dealing bonus critical damage.' },
    },
    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        this.render();
        this.addEventListeners();
    },
    render() {
        const statsContainer = ui.tabContentStats;
        if (!statsContainer || !state.player) return;
        const p = state.player;
        const canUpgrade = p.attributePoints >= gddConstants.AP_PER_LEVEL;
        const createStatLine = (attrKey, value, isUpgradable = false) => {
            const meta = this.statMetadata[attrKey] || { name: attrKey, icon: '?', description: 'No info available.' };
            const upgradeButton = isUpgradable ? `<button class="attr-btn" data-attr="${attrKey}" ${!canUpgrade ? 'disabled' : ''}>+</button>` : '';
            const infoButton = `<button class="info-btn" data-title="${meta.name}" data-description="${meta.description}">i</button>`;
            return `
            <div class="stat-line">
                <span class="stat-icon">${meta.icon}</span>
                <span class="stat-name text-glow-subtle">${meta.name}</span>
                <span class="stat-value text-glow-subtle" data-stat-value="${attrKey}">${value}</span>
                ${upgradeButton}
                ${infoButton}
            </div>`;
        };
        const createHpLine = () => {
            const meta = this.statMetadata.maxHp;
            const hpPercent = (p.hp / p.derivedStats.maxHp) * 100;
            return `
            <div class="stat-line">
                <span class="stat-icon">${meta.icon}</span>
                <span class="stat-name text-glow-subtle">${meta.name}</span>
                <div class="flex-grow flex items-center gap-2">
                    <div class="progress-bar-track h-3 flex-grow"><div class="progress-bar-fill h-full" style="width: ${hpPercent}%; background-color: var(--hp-color);"></div></div>
                    <span class="stat-value text-glow-subtle">${Math.ceil(p.hp)} / ${Math.ceil(p.derivedStats.maxHp)}</span>
                </div>
                <button class="info-btn" data-title="${meta.name}" data-description="${meta.description}">i</button>
            </div>`;
        };
        statsContainer.innerHTML = `
        <div id="stats-container" class="space-y-3">
            <div class="stat-accordion-item open">
                <button class="stat-accordion-header">
                    <h3 class="text-glow-subtle font-orbitron">Secondary Attributes</h3>
                    <svg class="accordion-arrow w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
                <div class="stat-accordion-content">
                    ${createStatLine('STR', Math.round(p.baseStats.STR), true)}
                    ${createStatLine('DEX', Math.round(p.baseStats.DEX), true)}
                    ${createStatLine('VIT', Math.round(p.baseStats.VIT), true)}
                    ${createStatLine('NTL', Math.round(p.baseStats.NTL), true)}
                    ${createStatLine('WIS', Math.round(p.baseStats.WIS), true)}
                    <div class="stat-line mt-2">
                        <span class="stat-icon">💎</span>
                        <span class="stat-name text-glow-subtle">Unspent Points</span>
                        <span id="unspent-points-value" class="stat-value text-glow-label">${p.attributePoints || 0}</span>
                    </div>
                </div>
            </div>
            <div class="stat-accordion-item">
                <button class="stat-accordion-header">
                    <h3 class="text-glow-subtle font-orbitron">Primary Combat Stats</h3>
                    <svg class="accordion-arrow w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
                <div class="stat-accordion-content">
                    ${createStatLine('finalWC', p.derivedStats.WC.toFixed(2))}
                    ${createStatLine('finalSC', p.derivedStats.SC.toFixed(2))}
                    ${createStatLine('finalAC', p.derivedStats.AC.toFixed(2))}
                </div>
            </div>
            <div class="stat-accordion-item">
                <button class="stat-accordion-header">
                    <h3 class="text-glow-subtle font-orbitron">Derived Stats</h3>
                    <svg class="accordion-arrow w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
                <div class="stat-accordion-content">
                    ${createHpLine()}
                    ${createStatLine('hitChance', `${p.derivedStats.hitChance.toFixed(2)}%`)}
                    ${createStatLine('critChance', `${p.derivedStats.critChance.toFixed(2)}%`)}
                </div>
            </div>
        </div>`;
    },
    addEventListeners() {
        const statsContainer = ui.tabContentStats;
        statsContainer.addEventListener('click', (e) => {
            const header = e.target.closest('.stat-accordion-header');
            const attrBtn = e.target.closest('.attr-btn');
            const infoBtn = e.target.closest('.info-btn');
            if (header) {
                header.parentElement.classList.toggle('open');
            } else if (attrBtn) {
                ProfileManager.spendAttributePoint(attrBtn.dataset.attr);
            } else if (infoBtn) {
                this.showStatInfo(infoBtn.dataset.title, infoBtn.dataset.description);
            }
        });
        document.getElementById('stat-info-backdrop').addEventListener('click', () => this.hideStatInfo());
    },
    showStatInfo(title, description) {
        const modal = document.getElementById('stat-info-modal');
        modal.querySelector('#stat-info-title').textContent = title;
        modal.querySelector('#stat-info-description').textContent = description;
        modal.style.display = 'flex';
    },
    hideStatInfo() {
        document.getElementById('stat-info-modal').style.display = 'none';
    }
};

export const InventoryManager = {
    isInitialized: false,
    MAX_GEMS: 200,
    filterState: { category: 'All', subType: 'All', tier: 'All', quality: 'All', sortBy: 'tier', order: 'desc' },
    inventoryBags: {
        'Weapon Chest': ['Weapons'],
        'Bag of Gear': ['Armor'],
        'Jewelry Box': ['Amulet', 'Ring', 'Accessory'],
        'Spell Satchel': ['Spells'],
    },
    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        this.renderInventoryTab();
        this.addEventListeners();
        this.populateFilterOptions();
        this.updateAllViews();
    },
    renderInventoryTab() {
        const inventoryContainer = ui.tabContentInventory;
        let bagsHTML = "";
        for (const bagName in this.inventoryBags) {
            bagsHTML += `
            <div class="stat-accordion-item open" data-bag-container="${bagName}">
                <button class="stat-accordion-header">
                    <h3 class="text-glow-subtle font-orbitron">${bagName} <span id="inventory-${bagName.replace(/\s+/g, '-')}-count" class="text-xs text-gray-400 font-sans"></span></h3>
                    <svg class="accordion-arrow w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
                <div class="stat-accordion-content !p-2">
                    <div class="inventory-grid" data-bag-name="${bagName}"></div>
                </div>
            </div>`;
        }
        inventoryContainer.innerHTML = `
        <div id="inventory-sort-container" class="mb-2">
            <div class="stat-accordion-item open">
                <button class="stat-accordion-header">
                    <h3 class="text-glow-subtle font-orbitron"><svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9M3 12h9m-9 4h6"></path></svg>Sort & Filter</h3>
                    <svg class="accordion-arrow w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
                <div class="stat-accordion-content !p-2">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div><label class="text-xs text-gray-400">Category</label><select id="inventory-filter-category-select" class="editor-input !w-full !text-xs"></select></div>
                        <div><label class="text-xs text-gray-400">Sub-Type</label><select id="inventory-filter-subtype-select" class="editor-input !w-full !text-xs"></select></div>
                        <div><label class="text-xs text-gray-400">Tier</label><select id="inventory-filter-tier-select" class="editor-input !w-full !text-xs"></select></div>
                        <div><label class="text-xs text-gray-400">Quality</label><select id="inventory-filter-quality-select" class="editor-input !w-full !text-xs"></select></div>
                    </div>
                    <div class="grid grid-cols-2 gap-2 mt-2 border-t border-gray-700 pt-2">
                        <div><label class="text-xs text-gray-400">Sort By</label><select id="inventory-sort-by-select" class="editor-input !w-full !text-xs"><option value="tier">Tier</option><option value="name">Name</option><option value="type">Type</option></select></div>
                        <div><label class="text-xs text-gray-400">Order</label><select id="inventory-sort-order-select" class="editor-input !w-full !text-xs"><option value="desc">Descending</option><option value="asc">Ascending</option></select></div>
                    </div>
                </div>
            </div>
        </div>
        ${bagsHTML}
        <div class="stat-accordion-item open">
            <button class="stat-accordion-header">
                <h3 class="text-glow-subtle font-orbitron">Gem Pouch <span id="inventory-gem-pouch-count" class="text-xs text-gray-400 font-sans"></span></h3>
                <svg class="accordion-arrow w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            </button>
            <div class="stat-accordion-content !p-2">
                <div class="gem-pouch-grid"></div>
            </div>
        </div>`;
    },
    addEventListeners() {
        const inventoryContainer = ui.tabContentInventory;
        inventoryContainer.addEventListener('click', e => {
            const slot = e.target.closest('.inventory-slot');
            const gemItem = e.target.closest('.gem-item');
            const header = e.target.closest('.stat-accordion-header');
            if (slot?.dataset.instanceId) this.showItemActionModal(slot.dataset.instanceId, null);
            else if (gemItem?.dataset.gemId) this.showItemActionModal(null, gemItem.dataset.gemId);
            else if (header) header.parentElement.classList.toggle('open');
        });
        inventoryContainer.addEventListener('change', e => {
            const targetId = e.target.id;
            if (targetId.startsWith('inventory-filter-') || targetId.startsWith('inventory-sort-')) {
                this.filterState.category = document.getElementById('inventory-filter-category-select').value;
                this.filterState.subType = document.getElementById('inventory-filter-subtype-select').value;
                this.filterState.tier = document.getElementById('inventory-filter-tier-select').value;
                this.filterState.quality = document.getElementById('inventory-filter-quality-select').value;
                this.filterState.sortBy = document.getElementById('inventory-sort-by-select').value;
                this.filterState.order = document.getElementById('inventory-sort-order-select').value;
                if (targetId === 'inventory-filter-category-select') {
                    this.populateSubTypeFilter();
                    this.filterState.subType = 'All';
                    document.getElementById('inventory-filter-subtype-select').value = 'All';
                }
                this.renderInventoryBags();
            }
        });
        document.getElementById('item-action-modal-backdrop').addEventListener('click', () => this.hideItemActionModal());
    },
    populateFilterOptions() {
        document.getElementById('inventory-filter-category-select').innerHTML = ['All', ...Object.keys(this.inventoryBags)].map(c => `<option value="${c}">${c}</option>`).join("");
        document.getElementById('inventory-filter-tier-select').innerHTML = '<option value="All">All Tiers</option>' + Array.from({length: 20}, (_, i) => `<option value="${i+1}">Tier ${i+1}</option>`).join("");
        document.getElementById('inventory-filter-quality-select').innerHTML = ['All', 'Dropper', 'Shadow', 'Echo'].map(q => `<option value="${q}">${q}</option>`).join("");
        this.populateSubTypeFilter();
    },
    populateSubTypeFilter() {
        const category = document.getElementById('inventory-filter-category-select').value;
        const subTypeSelect = document.getElementById('inventory-filter-subtype-select');
        let subTypes = new Set();
        const itemsToScan = items.baseItemTemplates.filter(item => {
            if (category === 'All') return true;
            return this.inventoryBags[category]?.includes(item.type);
        });
        itemsToScan.forEach(item => subTypes.add(item.subType || item.type));
        subTypeSelect.innerHTML = ['All', ...Array.from(subTypes).sort()].map(s => `<option value="${s}">${s}</option>`).join("");
    },
    renderInventoryBags() {
        const equippedIds = Object.values(state.player.equipment).filter(Boolean);
        let unequippedItems = state.player.inventory.filter(item => !equippedIds.includes(item.instanceId));
        const { category, subType, tier, quality} = this.filterState;
        const filteredItems = unequippedItems.filter(item => {
            const base = items.baseItemTemplates.find(b => b.id === item.baseItemId);
            if (!base) return false;
            if (category !== 'All' && !this.inventoryBags[category]?.includes(base.type)) return false;
            if (subType !== 'All' && (base.subType || base.type) !== subType) return false;
            if (tier !== 'All' && item.tier.toString() !== tier) return false;
            if (quality !== 'All' && item.type !== quality) return false;
            return true;
        });
        filteredItems.sort((a, b) => {
            const baseA = items.baseItemTemplates.find(item => item.id === a.baseItemId);
            const baseB = items.baseItemTemplates.find(item => item.id === b.baseItemId);
            let compareA = (this.filterState.sortBy === 'name') ? baseA.name : (this.filterState.sortBy === 'type' ? baseA.type : a.tier);
            let compareB = (this.filterState.sortBy === 'name') ? baseB.name : (this.filterState.sortBy === 'type' ? baseB.type : b.tier);
            if (compareA < compareB) return this.filterState.order === 'asc' ? -1 : 1;
            if (compareA > compareB) return this.filterState.order === 'asc' ? 1 : -1;
            return 0;
        });
        document.querySelectorAll('#tab-content-inventory .inventory-grid').forEach(grid => grid.innerHTML = "");
        filteredItems.forEach(item => {
            const base = items.baseItemTemplates.find(b => b.id === item.baseItemId);
            for (const bagName in this.inventoryBags) {
                if (this.inventoryBags[bagName].includes(base.type)) {
                    const grid = document.querySelector(`#tab-content-inventory .inventory-grid[data-bag-name="${bagName}"]`);
                    if (grid) {
                        let overlaysHTML = this.generateGemOverlaysHTML(item);
                        grid.innerHTML += `
                        <div class="inventory-slot" data-instance-id="${item.instanceId}">
                            ${overlaysHTML}
                            <img src="${base.imageUrl}" onerror="this.onerror=null;this.src='https://placehold.co/60x60/1f2937/ffffff?text=ERR';">
                            <span class="item-tier-label">T${item.tier}</span>
                        </div>`;
                    }
                    break;
                }
            }
        });
        this.updateCounts();
    },
    updateAllViews() {
        this.renderInventoryBags();
        this.renderGemPouch();
        this.updateCounts();
    },
    updateCounts() {
        const equippedIds = Object.values(state.player.equipment).filter(Boolean);
        const unequippedItems = state.player.inventory.filter(item => !equippedIds.includes(item.instanceId));
        for (const bagName in this.inventoryBags) {
            const count = unequippedItems.filter(item => {
                const baseItem = items.baseItemTemplates.find(b => b.id === item.baseItemId);
                return baseItem && this.inventoryBags[bagName].includes(baseItem.type);
            }).length;
            document.getElementById(`inventory-${bagName.replace(/\s+/g, '-')}-count`).textContent = `(${count})`;
        }
        document.getElementById('inventory-gem-pouch-count').textContent = `(${state.player.gems.length}/${this.MAX_GEMS})`;
    },
    renderGemPouch() {
        const grid = document.querySelector('#tab-content-inventory .gem-pouch-grid');
        if (!grid) return;
        grid.innerHTML = state.player.gems.map(gemInfo => {
            const gem = gems.standard[gemInfo.id];
            return `
            <div class="gem-item" data-gem-id="${gemInfo.id}"><img src="https://placehold.co/40x40/1f2937/ffffff?text=${gem.name.slice(0,2)}" class="w-10 h-10"><span class="item-label text-glow-subtle">${gem.name.slice(0,3)}${gemInfo.grade}</span></div>`;
        }).join("");
    },
    showItemActionModal(instanceId, gemId) {
        const modalBody = document.getElementById('item-action-modal-body');
        let contentHTML = "", actionButtonHTML = "", actionHandler = null;
        if (instanceId) {
            const item = state.player.inventory.find(i => i.instanceId === instanceId);
            if (!item) return;
            const baseItem = items.baseItemTemplates.find(b => b.id === item.baseItemId);
            const isEquipped = Object.values(state.player.equipment).includes(instanceId);
            let gemListHTML = item.socketedGems?.filter(g => g).length > 0 ? `<div class="item-gem-list">${item.socketedGems.map(gemInfo => {
                if (!gemInfo) return "";
                const gemData = gems.standard[gemInfo.id];
                return `<div class="item-gem-entry"><span class="item-gem-name">${gemData.name.slice(0,3)}${gemInfo.grade}</span><span class="item-gem-effect">${gemData.effect || 'N/A'}</span></div>`;
            }).join("")}</div>` : "";
            contentHTML = `<div class="item-name text-glow-subtle">${baseItem.name}</div><div class="item-type">Tier ${item.tier} ${baseItem.type}</div>${gemListHTML}`;
            actionButtonHTML = `<button id="item-action-button" class="glass-button w-full py-2 rounded-md mt-4">${isEquipped ? 'Unequip' : 'Equip'}</button>`;
            actionHandler = () => isEquipped ? this.unequipItem(instanceId) : this.equipItem(instanceId);
        } else if (gemId) {
            const gemInfo = state.player.gems.find(g => g.id === gemId);
            if (!gemInfo) return;
            const gemData = gems.standard[gemId];
            contentHTML = `<div class="item-name text-glow-subtle">${gemData.name}</div><div class="item-type">Grade ${gemInfo.grade} Gem</div><div class="item-stat"><span class="item-stat-label">Effect: </span><span class="item-stat-value text-glow-label">${gemData.effect || 'N/A'}</span></div>`;
        }
        modalBody.innerHTML = contentHTML + actionButtonHTML;
        document.getElementById('item-action-modal-content').style.display = 'block';
        document.getElementById('item-action-modal-backdrop').style.display = 'block';
        const actionButton = document.getElementById('item-action-button');
        if (actionButton && actionHandler) actionButton.addEventListener('click', actionHandler, { once: true });
    },
    hideItemActionModal() {
        document.getElementById('item-action-modal-content').style.display = 'none';
        document.getElementById('item-action-modal-backdrop').style.display = 'none';
    },
    equipItem(instanceId) {
        const item = state.player.inventory.find(i => i.instanceId === instanceId);
        if (!item) return;
        const baseItem = items.baseItemTemplates.find(b => b.id === item.baseItemId);
        if (!baseItem) return;
        
        const slotType = baseItem.type;
        let targetSlotName = equipmentSlotConfig.find(slot => slot.type === slotType && !state.player.equipment[slot.name])?.name;

        if (!targetSlotName) {
            targetSlotName = equipmentSlotConfig.find(slot => slot.type === slotType)?.name;
        }

        if (!targetSlotName) {
            showToast(`No available slot for ${slotType}.`, true);
            return;
        }
        
        if (state.player.equipment[targetSlotName]) {
            this.unequipItem(state.player.equipment[targetSlotName], false);
        }
        
        state.player.equipment[targetSlotName] = instanceId;
        
        this.hideItemActionModal();
        this.updateAllViews();
        if (EquipmentManager.isInitialized) EquipmentManager.renderEquipmentView();
        Systems.calculateDerivedStats(state.player);
        showToast(`${baseItem.name} equipped.`, false);
        DataManager.updatePlayer({ equipment: state.player.equipment });
    },
    unequipItem(instanceId, showModalUpdate = true) {
        const slotName = Object.keys(state.player.equipment).find(key => state.player.equipment[key] === instanceId);
        if (!slotName) return;
        const item = state.player.inventory.find(i => i.instanceId === instanceId);
        const baseItem = items.baseItemTemplates.find(b => b.id === item.baseItemId);
        state.player.equipment[slotName] = null;
        this.hideItemActionModal();
        if (showModalUpdate) {
            this.updateAllViews();
            if (EquipmentManager.isInitialized) EquipmentManager.renderEquipmentView();
        }
        Systems.calculateDerivedStats(state.player);
        showToast(`${baseItem.name} unequipped.`, false);
        DataManager.updatePlayer({ equipment: state.player.equipment });
    },
    generateGemOverlaysHTML(item) {
        let overlaysHTML = '';
        if (item.socketedGems && item.socketedGems.length > 0) {
            overlaysHTML += '<div class="gem-overlays-container">';
            const gem1 = item.socketedGems[0];
            const gem2 = item.socketedGems[1];
            if (gem1) {
                const gemData1 = gems.standard[gem1.id];
                overlaysHTML += `<div class="gem-overlay ${gemData1.category.toLowerCase()}">${gemData1.name.slice(0,3)}</div>`;
            }
            if (!gem1 && gem2) overlaysHTML += '<div></div>';
            if (gem2) {
                const gemData2 = gems.standard[gem2.id];
                overlaysHTML += `<div class="gem-overlay ${gemData2.category.toLowerCase()}">${gemData2.name.slice(0,3)}</div>`;
            }
            overlaysHTML += '</div>';
        }
        return overlaysHTML;
    }
};

export const EquipmentManager = {
    isInitialized: false,
    init() {
        if(this.isInitialized) return;
        this.isInitialized = true;
        this.renderEquipmentView();
        this.addEventListeners();
    },
    renderEquipmentView() {
        const equipmentContainer = ui.tabContentEquipment;
        if (!equipmentContainer) return;
        const slotsHTML = equipmentSlotConfig.map(slot => {
            const instanceId = state.player.equipment[slot.name];
            const item = state.player.inventory.find(i => i.instanceId === instanceId);
            let contentHTML = '<span class="text-xs text-gray-500">Empty</span>';
            if (item) {
                const base = items.baseItemTemplates.find(b => b.id === item.baseItemId);
                let overlaysHTML = InventoryManager.generateGemOverlaysHTML(item);
                contentHTML = `
                    ${overlaysHTML}
                    <img src="${base.imageUrl}" class="h-12 w-12 object-contain" onerror="this.onerror=null;this.src='https://placehold.co/48x48/1f2937/ffffff?text=ERR';">
                    <span class="item-tier-label">T${item.tier}</span>`;
            }
            return`
            <div class="equipment-slot-wrapper">
                <div class="equipment-slot-title font-orbitron text-glow-subtle"><span>${slot.name}</span></div>
                <div class="equipment-slot-content" data-slot-name="${slot.name}" data-instance-id="${instanceId || ""}">${contentHTML}</div>
            </div>`;
        }).join("");
        equipmentContainer.innerHTML = `<div class="equipment-grid">${slotsHTML}</div>`;
    },
    addEventListeners() {
        const equipmentContainer = ui.tabContentEquipment;
        equipmentContainer.addEventListener('click', e => {
            const slot = e.target.closest('.equipment-slot-content');
            if (slot && slot.dataset.instanceId) {
                InventoryManager.showItemActionModal(slot.dataset.instanceId, null);
            }
        });
    },
};

export const SettingsManager = {
    isInitialized: false,
    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        this.render();
        this.addEventListeners();
        this.updateButtonStates();
    },
    render() {
        ui.tabContentSettings.innerHTML = `
        <div class="space-y-4">
            <div class="stat-accordion-item open">
                <button class="stat-accordion-header">
                    <h3 class="text-glow-subtle font-orbitron">UI Theme</h3>
                    <svg class="accordion-arrow w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
                <div class="stat-accordion-content">
                    <p class="text-sm text-gray-400 mb-4">Select a visual theme for the game interface.</p>
                    <div class="flex flex-col sm:flex-row gap-4">
                        <button class="theme-select-btn glass-button w-full py-3 rounded-md" data-theme="aetherial-shard">Aetherial Shard</button>
                        <button class="theme-select-btn glass-button w-full py-3 rounded-md" data-theme="molten-core">Molten Core</button>
                    </div>
                </div>
            </div>
             <div class="stat-accordion-item open">
                <button class="stat-accordion-header">
                    <h3 class="text-glow-subtle font-orbitron">Map Import</h3>
                    <svg class="accordion-arrow w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
                <div class="stat-accordion-content">
                    <p class="text-sm text-gray-400 mb-2">Import a map JSON file from the Map Editor.</p>
                    <input type="file" id="map-import-input" accept=".json" class="hidden">
                    <button id="import-map-btn" class="glass-button w-full py-2">Import Map</button>
                </div>
            </div>
        </div>`;
    },
    addEventListeners() {
        ui.tabContentSettings.addEventListener('click', e => {
            const themeBtn = e.target.closest('.theme-select-btn');
            if (themeBtn) this.setTheme(themeBtn.dataset.theme);
            const importBtn = e.target.closest('#import-map-btn');
            if (importBtn) document.getElementById('map-import-input').click();
        });
        ui.tabContentSettings.addEventListener('change', e => {
            if (e.target.id === 'map-import-input') {
                MapLoader.loadMapFile(e.target.files[0]);
            }
        });
    },
    setTheme(themeName) {
        document.body.className = `bg-black text-gray-200 theme-${themeName}`;
        localStorage.setItem('geminusTheme', themeName);
        this.updateButtonStates();
        updateSmokeParticleColors(themeName);
    },
    loadTheme() {
        const savedTheme = localStorage.getItem('geminusTheme') || 'aetherial-shard';
        this.setTheme(savedTheme);
        initSmokeParticles(savedTheme);
    },
    updateButtonStates() {
        const currentTheme = localStorage.getItem('geminusTheme') || 'aetherial-shard';
        document.querySelectorAll('.theme-select-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === currentTheme);
        });
    }
};

export const MapDataStore = {
    data: null,
    assetImages: {},
    isLoaded: false,
    async load(zoneData) {
        this.isLoaded = false;
        console.log(`Loading new map: ${zoneData.zoneName}`);
        this.data = zoneData;
        
        const assetPromises = [];
        if (this.data.assetLibrary) {
            for (const assetId in this.data.assetLibrary) {
                const asset = this.data.assetLibrary[assetId];
                if (asset.imageUrl && !this.assetImages[asset.imageUrl]) {
                    assetPromises.push(new Promise((resolve) => {
                        const img = new Image();
                        img.crossOrigin = 'Anonymous';
                        img.onload = () => { this.assetImages[asset.imageUrl] = img; resolve(); };
                        img.onerror = () => { console.warn(`Failed to load asset image: ${asset.imageUrl}`); resolve(); };
                        img.src = asset.imageUrl;
                    }));
                }
            }
        }
        await Promise.all(assetPromises);
        this.isLoaded = true;
        console.log("Map data loaded and assets pre-cached.");
    },
    getAssetImage(assetId) {
        const asset = this.data.assetLibrary?.[assetId];
        return asset?.imageUrl ? this.assetImages[asset.imageUrl] : null;
    }
};

export const MapLoader = {
    loadMapFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const mapData = JSON.parse(e.target.result);
                if (!mapData.layers || !mapData.assetLibrary) {
                    throw new Error("Invalid map file format.");
                }
                await MapDataStore.load(mapData);
                ZoneManager.loadZone(MapDataStore.data);
                showToast("Map imported successfully!");
            } catch (error) {
                console.error("Error loading map file:", error);
                showToast(`Failed to load map: ${error.message}`, true);
            }
        };
        reader.readAsText(file);
    }
};

export class MapRenderer {
    constructor(canvas, isMiniMap = false) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.isMiniMap = isMiniMap;
    }
    resize() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth * dpr;
        this.canvas.height = container.clientHeight * dpr;
        this.ctx.scale(dpr, dpr);
    }
    getHexPoints(size) {
        const points = [];
        for (let i = 0; i < 6; i++) {
            const angle_deg = 60 * i - 30;
            const angle_rad = Math.PI / 180 * angle_deg;
            points.push(size * Math.cos(angle_rad), size * Math.sin(angle_rad));
        }
        return points;
    }
    draw(mapData, playerPos) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
        if (!mapData || !mapData.layers || !playerPos) return;

        const mapSize = mapData.mapSize;
        if (this.isMiniMap) {
            ctx.beginPath();
            ctx.arc(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, this.canvas.clientWidth / 2, 0, Math.PI * 2);
            ctx.clip();
        }
        
        const TILE_SIZE = this.isMiniMap ? 15 : 64;

        ctx.save();
        
        const playerPixelX = playerPos.x * TILE_SIZE * 0.75;
        const playerPixelY = playerPos.y * TILE_SIZE * (Math.sqrt(3)/2) + (playerPos.x % 2 === 1 ? TILE_SIZE * (Math.sqrt(3)/4) : 0);
        
        ctx.translate(this.canvas.clientWidth / 2 - playerPixelX, this.canvas.clientHeight / 2 - playerPixelY);

        mapData.layers.forEach(layer => {
            if (!layer.isVisible) return;
            layer.grid.forEach((row, y) => {
                row.forEach((tile, x) => {
                    const posX = x * TILE_SIZE * 0.75;
                    const posY = y * TILE_SIZE * (Math.sqrt(3)/2) + (x % 2 === 1 ? TILE_SIZE * (Math.sqrt(3)/4) : 0);

                    if (layer.id === 'ground' && tile && tile.type !== 'empty' && tile.type !== 'wall') {
                        ctx.beginPath();
                        const points = this.getHexPoints(TILE_SIZE / 2);
                        ctx.moveTo(posX + points[0], posY + points[1]);
                        for (let i = 2; i < points.length; i += 2) ctx.lineTo(posX + points[i], posY + points[i + 1]);
                        ctx.closePath();
                        const BIOME_COLORS = { "forest": '#4A6B4A', "desert": '#D2B48C' };
                        ctx.fillStyle = BIOME_COLORS[mapData.biome] || '#696969';
                        ctx.fill();
                        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                        ctx.stroke();
                    }

                    if (layer.id === 'objects' && tile) {
                        const asset = mapData.assetLibrary?.[tile.assetId];
                        const assetImage = MapDataStore.getAssetImage(tile.assetId);

                        if (assetImage) {
                            const scale = asset.scale || 1;
                            const yOffset = asset.yOffset || 0;
                            const drawSize = TILE_SIZE * scale;
                            ctx.drawImage(assetImage, posX - drawSize / 2, posY - drawSize / 2 + yOffset, drawSize, drawSize);
                        }
                    }
                });
            });
        });

        ctx.font = `${TILE_SIZE * 0.7}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👤', playerPixelX, playerPixelY);
        
        ctx.restore();
    }
}

export const WorldMapManager = {
    isInitialized: false,
    mapRenderer: null,
    init() {
        if (this.isInitialized) return;
        this.mapRenderer = new MapRenderer(ui.miniMapCanvas, true);
        this.isInitialized = true;
        this.mapRenderer.resize();
        this.draw();
    },
    draw() {
        if (!this.isInitialized || !state.player) return;
        this.mapRenderer.draw(MapDataStore.data, state.player.pos);
    }
};

export const ZoneManager = {
    isInitialized: false,
    mapRenderer: null,
    isLoaded: false,
    init() {
        if (this.isInitialized) return;
        this.mapRenderer = new MapRenderer(ui.zoneCanvas, false);
        this.isInitialized = true;
    },
    loadZone(zoneData) {
        this.isLoaded = false;
        state.zone.name = zoneData.zoneName;
        document.getElementById('world-map-title').textContent = zoneData.zoneName;

        if (state.player && zoneData.spawnPoints && zoneData.spawnPoints.length > 0) {
            state.player.pos.x = zoneData.spawnPoints[0].x;
            state.player.pos.y = zoneData.spawnPoints[0].y;
        }

        this.isLoaded = true;
        this.resizeCanvas();
        this.draw();
        WorldMapManager.draw();
        UIManager.updatePlayerStatusUI();
    },
    resizeCanvas() {
        if(this.mapRenderer) this.mapRenderer.resize();
    },
    draw() {
        if (!state.player) return;
        this.mapRenderer.draw(MapDataStore.data, state.player.pos);
    }
};

export const GameManager = {
    isInitialized: false,
    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        ui.gameHudScreen.style.display = 'block';
        Systems.calculateDerivedStats(state.player);
        ProfileManager.updateAllProfileUI();
        
        WorldMapManager.init();
        ZoneManager.init();
        initControls();
        this.setupEventListeners();
        
        if (embeddedZoneData) {
            MapDataStore.load(embeddedZoneData).then(() => {
                ZoneManager.loadZone(MapDataStore.data);
                this.switchTab('equipment');
            });
        } else {
            this.switchTab('settings');
            setTimeout(() => showToast("Import a map from the Map Editor to start.", false), 1000);
        }
        
        LayoutManager.init();
        // ChatManager.init(); // To be added
    },
    setupEventListeners() {
        ui.mainTabsContainer.addEventListener('click', (e) => {
            if (state.ui.isLayoutEditMode || !e.target.classList.contains('main-tab-button')) return;
            this.switchTab(e.target.dataset.tab);
        });
        ui.focusModeBtn.addEventListener('click', () => {
            state.ui.isFocused = !state.ui.isFocused;
            ui.mainContent.classList.toggle('focused', state.ui.isFocused);
        });
        ui.toggleControlsBtn.addEventListener('click', () => ui.footerSection.classList.toggle('controls-hidden'));
        ui.layoutEditBtn.addEventListener('click', () => LayoutManager.toggleEditMode());
        ui.miniMapPanel.addEventListener('click', () => {
            ui.fullScreenMapOverlay.classList.remove('hidden');
            ZoneManager.resizeCanvas();
            ZoneManager.draw();
        });
        ui.mapCloseBtn.addEventListener('click', () => ui.fullScreenMapOverlay.classList.add('hidden'));
    },
    switchTab(tabName) {
        document.querySelectorAll('#main-tabs-container .main-tab-button, #main-tab-content .main-tab-panel').forEach(el => el.classList.remove('active'));
        const tabButton = document.querySelector(`.main-tab-button[data-tab="${tabName}"]`);
        const tabPanel = document.getElementById(`tab-content-${tabName}`);
        if (tabButton) tabButton.classList.add('active');
        if (tabPanel) tabPanel.classList.add('active');
        const managers = {
            combat: CombatManager, stats: StatsManager, inventory: InventoryManager,
            equipment: EquipmentManager, settings: SettingsManager
        };
        if (managers[tabName] && !managers[tabName].isInitialized) {
            managers[tabName].init();
        }
    }
};

export const LayoutManager = {
    selectedItem: null, initialPinchDistance: 0, resizingElement: null,
    init() { this.loadLayout(); this.addEventListeners(); },
    toggleEditMode() {
        state.ui.isLayoutEditMode = !state.ui.isLayoutEditMode;
        document.getElementById('layout-container').classList.toggle('layout-edit-mode', state.ui.isLayoutEditMode);
        if (!state.ui.isLayoutEditMode) {
            if (this.selectedItem) { this.selectedItem.classList.remove('layout-selected'); this.selectedItem = null; }
            this.saveLayout();
            showToast('Layout Saved!');
        } else {
            this.showTutorial();
            showToast('Layout Edit: Tap to select, tap again to swap.');
        }
    },
    addEventListeners() {
        const container = document.getElementById('layout-container');
        container.addEventListener('click', e => this.handleTap(e));
        container.addEventListener('touchstart', e => this.handleTouchStart(e), { passive: false });
        container.addEventListener('touchmove', e => this.handleTouchMove(e), { passive: false });
        container.addEventListener('touchend', e => this.handleTouchEnd(e));
    },
    handleTap(e) {
        if (!state.ui.isLayoutEditMode) return;
        const tappedTab = e.target.closest('.tappable-tab');
        if (tappedTab) { e.preventDefault(); e.stopPropagation(); this.processSelection(tappedTab, 'tab'); return; }
        const tappedSection = e.target.closest('.tappable-section');
        if (tappedSection) this.processSelection(tappedSection, 'section');
    },
    processSelection(element, type) {
        if (!this.selectedItem) {
            this.selectedItem = element;
            element.classList.add('layout-selected');
        } else {
            if (this.selectedItem === element) {
                element.classList.remove('layout-selected');
                this.selectedItem = null;
            } else if (this.selectedItem.classList.contains(`tappable-${type}`) && element.classList.contains(`tappable-${type}`)) {
                const parent = element.parentNode;
                const selectedNext = this.selectedItem.nextSibling;
                parent.insertBefore(this.selectedItem, element);
                parent.insertBefore(element, selectedNext);
                this.selectedItem.classList.remove('layout-selected');
                this.selectedItem = null;
            } else {
                this.selectedItem.classList.remove('layout-selected');
                this.selectedItem = element;
                element.classList.add('layout-selected');
            }
        }
    },
    handleTouchStart(e) {
        if (!state.ui.isLayoutEditMode || e.touches.length !== 2) return;
        this.resizingElement = e.target.closest('.tappable-section');
        if (!this.resizingElement) return;
        e.preventDefault();
        this.initialPinchDistance = this.getPinchDistance(e.touches);
        this.resizingElement.style.transition = 'none';
    },
    handleTouchMove(e) {
        if (!state.ui.isLayoutEditMode || e.touches.length !== 2 || !this.resizingElement) return;
        e.preventDefault();
        const newPinchDistance = this.getPinchDistance(e.touches);
        const scale = newPinchDistance / this.initialPinchDistance;
        let newHeight = this.resizingElement.offsetHeight * scale;
        const minHeight = 80;
        const maxHeight = ui.layoutContainer.offsetHeight * 0.7;
        newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
        this.resizingElement.style.flexBasis = `${newHeight}px`;
        this.resizingElement.style.flexGrow = '0';
        this.resizingElement.style.flexShrink = '0';
        this.initialPinchDistance = newPinchDistance;
    },
    handleTouchEnd(e) {
        if (this.resizingElement) {
            this.resizingElement.style.transition = '';
            this.resizingElement = null;
            this.initialPinchDistance = 0;
        }
    },
    getPinchDistance(touches) {
        return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
    },
    saveLayout() {
        const layoutData = {
            sections: [],
            tabs: [...document.querySelectorAll('.tappable-tab')].map(el => el.dataset.tab)
        };
        document.querySelectorAll('.tappable-section').forEach(el => {
            layoutData.sections.push({ id: el.id, size: el.style.flexBasis || null });
        });
        localStorage.setItem('geminusLayout', JSON.stringify(layoutData));
    },
    loadLayout() {
        const savedLayout = JSON.parse(localStorage.getItem('geminusLayout'));
        if (savedLayout) {
            const sectionContainer = document.getElementById('layout-container');
            const sectionMap = new Map([...sectionContainer.children].map(child => [child.id, child]));
            savedLayout.sections.forEach(sectionData => {
                const el = sectionMap.get(sectionData.id);
                if(el) {
                    sectionContainer.appendChild(el);
                    if (sectionData.size) {
                        el.style.flexBasis = sectionData.size;
                        el.style.flexGrow = '0'; el.style.flexShrink = '0';
                    }
                }
            });
            const tabContainer = document.getElementById('main-tabs-container');
            savedLayout.tabs.forEach(tab => {
                const el = tabContainer.querySelector(`[data-tab="${tab}"]`);
                if(el) tabContainer.appendChild(el);
            });
        }
    },
    showTutorial() {
        if (localStorage.getItem('geminusEditorTutorialSeen')) return;
        const tutorialHTML = `
        <div id="editor-tutorial-overlay" class="absolute inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 text-center text-white" style="border-radius: 0.5rem;">
            <div class="backdrop-blur-sm p-6 rounded-lg glass-panel !animation-name:none">
                <h3 class="font-orbitron text-2xl mb-4 text-glow-label">Layout Editor Guide</h3>
                <p class="mb-2">Tap a section, then tap another to <strong class="text-[var(--highlight-color)]">swap</strong>.</p>
                <p>Use a two-finger <strong class="text-[var(--highlight-color)]">pinch gesture</strong> to resize.</p>
                <button id="close-tutorial-btn" class="glass-button px-6 py-2 mt-6">Got It</button>
            </div>
        </div>`;
        ui.layoutContainer.insertAdjacentHTML('beforeend', tutorialHTML);

        const closeTutorial = (e) => {
            e.preventDefault(); e.stopPropagation();
            document.getElementById('editor-tutorial-overlay').remove();
            localStorage.setItem('geminusEditorTutorialSeen', 'true');
        };

        const closeBtn = document.getElementById('close-tutorial-btn');
        closeBtn.addEventListener('touchend', closeTutorial, { once: true });
        closeBtn.addEventListener('click', closeTutorial, { once: true });
    }
};

export function initControls() {
    const keyElements = document.querySelectorAll('.game-key');
    const setKeyState = (key, isPressed) => {
        state.keyState[key] = isPressed;
        document.querySelectorAll(`[data-key="${key}"]`).forEach(el => el.classList.toggle('pressed', isPressed));
    };
    const handleKeyPress = (key) => {
        if (!state.player || !ZoneManager.isLoaded || !MapDataStore.data) return;
        let dx = 0, dy = 0;
        switch(key) {
            case 'up': dy = -1; break;
            case 'down': dy = 1; break;
            case 'left': dx = -1; break;
            case 'right': dx = 1; break;
            case 'interact':
                if (SanctuaryManager.isPlayerDefeated) SanctuaryManager.revivePlayer();
                return;
        }
        const newX = state.player.pos.x + dx;
        const newY = state.player.pos.y + dy;
        const mapSize = MapDataStore.data.mapSize;
        const navigationLayer = MapDataStore.data.layers.find(l => l.id === 'navigation');
        
        if (newX >= 0 && newX < mapSize.width && newY >= 0 && newY < mapSize.height && navigationLayer.grid[newY][newX].isWalkable) {
            state.player.pos.x = newX;
            state.player.pos.y = newY;
            ZoneManager.draw();
            WorldMapManager.draw();
            UIManager.updatePlayerStatusUI();
        }
    };
    keyElements.forEach(element => {
        const key = element.dataset.key;
        if (!key) return;
        element.addEventListener('touchstart', (e) => { e.preventDefault(); setKeyState(key, true); handleKeyPress(key); }, { passive: false });
        element.addEventListener('touchend', (e) => { e.preventDefault(); setKeyState(key, false); }, { passive: false });
        element.addEventListener('mousedown', (e) => { e.preventDefault(); setKeyState(key, true); handleKeyPress(key); });
        element.addEventListener('mouseup', (e) => { e.preventDefault(); setKeyState(key, false); });
        element.addEventListener('mouseleave', () => { if (state.keyState[key]) setKeyState(key, false); });
    });
    window.addEventListener('keydown', (e) => {
        if(document.activeElement.tagName === 'INPUT') return;
        let key;
        switch(e.key) {
            case 'ArrowUp': case 'w': key = 'up'; break;
            case 'ArrowDown': case 's': key = 'down'; break;
            case 'ArrowLeft': case 'a': key = 'left'; break;
            case 'ArrowRight': case 'd': key = 'right'; break;
            case 'Enter': case ' ': key = 'interact'; break;
            default: return;
        }
        e.preventDefault();
        if (!state.keyState[key]) {
            setKeyState(key, true);
            handleKeyPress(key);
        }
    });
    window.addEventListener('keyup', (e) => {
        if(document.activeElement.tagName === 'INPUT') return;
        let key;
        switch(e.key) {
            case 'ArrowUp': case 'w': key = 'up'; break;
            case 'ArrowDown': case 's': key = 'down'; break;
            case 'ArrowLeft': case 'a': key = 'left'; break;
            case 'ArrowRight': case 'd': key = 'right'; break;
            case 'Enter': case ' ': key = 'interact'; break;
            default: return;
        }
        e.preventDefault();
        setKeyState(key, false);
    });
}

// --- Utility Functions ---
export function showToast(message, isError = false) {
    if (!ui.toastNotification) return;
    ui.toastNotification.textContent = message;
    ui.toastNotification.className = `glass-panel fixed left-1/2 -translate-x-1/2 z-[210] transition-all duration-500 ease-in-out px-6 py-3 rounded-lg font-semibold ${isError ? 'toast-error' : 'toast-success'}`;
    ui.toastNotification.style.bottom = '5rem';
    setTimeout(() => { ui.toastNotification.style.bottom = '-100px'; }, 3000);
}

