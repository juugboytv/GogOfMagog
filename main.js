// main.js
// This is the primary entry point for the Geminus application.
// Its sole responsibility is to initialize all the systems and managers in the correct order.

import { races } from './gdd.js';
import { 
    initializeManagers, 
    AuthManager, 
    DataManager,
    GameManager,
    initControls
} from './managers.js';

// --- Firebase Configuration ---

const appId = 'geminus-gog';

// --- Global App State & UI References ---
let state = {
    player: null,
    ui: {},
    game: { combatActive: false, currentZoneId: 'Z01' },
    zone: { name: "The First Step" },
    keyState: { up: false, left: false, down: false, right: false, interact: false },
    firebase: { db: null, auth: null, userId: null, playerDocRef: null },
};

const ui = {};

// --- Main Initialization Function ---
function main() {
    // 1. Collect all UI element references
    document.querySelectorAll('[id]').forEach(el => {
        const camelCaseId = el.id.replace(/-(\w)/g, (m, g) => g.toUpperCase());
        ui[camelCaseId] = el;
    });

    // 2. Give the managers access to the state and UI objects
    initializeManagers(state, ui);

    // 3. Initialize Firebase and set up the authentication listener
    const { initializeApp, getAuth, getFirestore, onAuthStateChanged, doc, getDoc } = window.firebase;
    const app = initializeApp(firebaseConfig);
    state.firebase.db = getFirestore(app);
    state.firebase.auth = getAuth(app);

    onAuthStateChanged(state.firebase.auth, async (user) => {
        if (user) {
            state.firebase.userId = user.uid;
            state.firebase.playerDocRef = doc(state.firebase.db, 'artifacts', appId, 'users', user.uid, 'playerData', 'main');
            
            const docSnap = await getDoc(state.firebase.playerDocRef);
            if (docSnap.exists()) {
                state.player = docSnap.data();
                if(typeof state.player.inventory === 'string') state.player.inventory = JSON.parse(state.player.inventory);
                if(typeof state.player.equipment === 'string') state.player.equipment = JSON.parse(state.player.equipment);
                if(typeof state.player.gems === 'string') state.player.gems = JSON.parse(state.player.gems);
                
                ui.loginScreen.classList.remove('active');
                ui.createAccountScreen.classList.remove('active');
                ui.gameContainer.classList.remove('hidden');
                GameManager.init();
            } else {
                ui.loginScreen.classList.remove('active');
                ui.createAccountScreen.classList.add('active');
            }
        } else {
            ui.loginScreen.classList.add('active');
            ui.createAccountScreen.classList.remove('active');
            ui.gameContainer.classList.add('hidden');
        }
    });

    // 4. Set up event listeners for the authentication forms
    ui.showCreateAccount.addEventListener('click', (e) => { e.preventDefault(); ui.loginScreen.classList.remove('active'); ui.createAccountScreen.classList.add('active'); });
    ui.showLogin.addEventListener('click', (e) => { e.preventDefault(); ui.createAccountScreen.classList.remove('active'); ui.loginScreen.classList.add('active'); });
    
    ui.loginBtn.addEventListener('click', () => {
        if(ui.loginEmail.value && ui.loginPassword.value) {
            AuthManager.login(ui.loginEmail.value, ui.loginPassword.value)
        }
    });

    ui.createBtn.addEventListener('click', () => {
        const selectedRace = document.querySelector('.race-option.selected')?.dataset.race;
        if(selectedRace && ui.createPlayerName.value && ui.createEmail.value && ui.createPassword.value) {
            AuthManager.createAccount(ui.createEmail.value, ui.createPassword.value, ui.createPlayerName.value, selectedRace);
        }
    });

    // 5. Dynamically populate the race grid & add validation listeners
    ui.creationRaceGrid.innerHTML = Object.keys(races)
        .map(raceId => `<div class="race-option p-3 text-center border border-[var(--border-color-main)] rounded-md cursor-pointer" data-race="${raceId}">${races[raceId].raceName}</div>`)
        .join("");
    
    const checkCreateForm = () => {
        const selectedRace = document.querySelector('.race-option.selected');
        const nameValid = ui.createPlayerName.value.trim().length >= 3;
        const emailValid = ui.createEmail.value.includes('@');
        const passwordValid = ui.createPassword.value.length >= 6;
        ui.createBtn.disabled = !(selectedRace && nameValid && emailValid && passwordValid);
    };
    [ui.createEmail, ui.createPassword, ui.createPlayerName].forEach(input => input.addEventListener('input', checkCreateForm));
    ui.creationRaceGrid.addEventListener('click', (e) => {
        const raceOption = e.target.closest('.race-option');
        if(raceOption) {
            ui.creationRaceGrid.querySelectorAll('.race-option').forEach(el => el.classList.remove('selected'));
            raceOption.classList.add('selected');
            checkCreateForm();
        }
    });
}

// --- Start the Game ---
document.addEventListener('DOMContentLoaded', main);

