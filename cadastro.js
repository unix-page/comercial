import {
  auth, loginGoogle, logout, registerEmailAccount, confirmVerifiedEmail,
  profileFor, activeProfile, setPreferredName
} from './firebase-core.js';
import { onAuthStateChanged, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

const $ = selector => document.querySelector(selector);
const status = $('#signupStatus');
let busy = false;
let generation = 0;


function cleanPreferredName() {
  return String(document.getElementById('signupGoogleName')?.value || '').trim().replace(/\s+/g, ' ');
}

function message(text, kind = '') {
  status.className = `signup-status${kind ? ` ${kind}` : ''}`;
  status.textContent = text;
}
function setBusy(on) {
  busy = on;
  for (const el of document.querySelectorAll('#signupForm button,#signupGoogle,#signupCheck,#signupResend,#signupLogout')) el.disabled = on;
}
function friendlyError(e) {
  const dictionary = {
    'auth/email-already-in-use': 'Este e-mail já possui conta. Utilize a tela Entrar ou recupere a senha.',
    'auth/invalid-email': 'Confira o e-mail digitado.',
    'auth/weak-password': 'Escolha uma senha mais forte, com pelo menos 8 caracteres.',
    'auth/unauthorized-domain': 'Este domínio não está autorizado no Firebase Authentication.',
    'auth/popup-blocked': 'O navegador bloqueou o login Google. Permita a janela de login.',
    'auth/popup-closed-by-user': 'O login Google foi fechado antes de terminar.',
    'auth/account-exists-with-different-credential': 'Este e-mail já foi usado de outra forma. Faça login pelo método anterior.',
    'permission-denied': 'O Firebase não permitiu criar o perfil. Confira se as regras de autocadastro foram publicadas.',
  };
  return dictionary[e?.code] || e?.message || 'Não foi possível concluir o cadastro.';
}
async function checkAccount(user) {
  const token = ++generation;
  $('#signupGo').hidden = true;
  $('#signupLogout').hidden = !user;
  if (!user) { message('Escolha uma das opções de cadastro.'); return; }
  if (!user.emailVerified) {
    message(`Conta ${user.email || ''} criada. Confira o e-mail, clique no link de confirmação e depois em “Já confirmei meu e-mail”.`);
    return;
  }
  try {
    const profile = await profileFor(user);
    if (token !== generation || auth.currentUser?.uid !== user.uid) return;
    if (!activeProfile(profile)) {
      message('Esta conta não está ativa. Consulte o administrador.', 'error');
      return;
    }
    message(`Conta pronta! ${profile.nome || user.email} • Perfil: ${profile.papel} • Ativo.`, 'success');
    $('#signupGo').hidden = false;
  } catch (e) {
    if (token !== generation) return;
    console.error('[Comercial Cadastro]', e);
    message(friendlyError(e), 'error');
  }
}

$('#signupGoogle').addEventListener('click', async () => {
  if (busy) return;
  const preferredName = cleanPreferredName();
  if (preferredName.length < 2) {
    message('Antes de entrar com Google, informe o nome que deseja ver no sistema.', 'error');
    document.getElementById('signupGoogleName')?.focus();
    return;
  }
  setBusy(true);
  message('Conectando ao Google...');
  try {
    const result = await loginGoogle();
    await setPreferredName(preferredName);
    await checkAccount(result.user);
  } catch (e) {
    console.error('[Comercial Cadastro Google]', e);
    message(friendlyError(e), 'error');
  } finally { setBusy(false); }
});
$('#signupForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  if (busy) return;
  const values = new FormData(ev.currentTarget);
  setBusy(true);
  message('Criando conta...');
  try {
    const user = await registerEmailAccount(values.get('nome'), values.get('email'), values.get('password'));
    await checkAccount(user);
  } catch (e) {
    console.error('[Comercial Cadastro E-mail]', e);
    message(friendlyError(e), 'error');
  } finally { setBusy(false); }
});
$('#signupCheck').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    const user = await confirmVerifiedEmail();
    await checkAccount(user);
  } catch (e) { message(friendlyError(e), 'error'); }
  finally { setBusy(false); }
});
$('#signupResend').addEventListener('click', async () => {
  if (busy) return;
  if (!auth.currentUser || auth.currentUser.emailVerified) {
    message('Entre na conta ainda não confirmada para reenviar a mensagem.', 'error');
    return;
  }
  setBusy(true);
  try { await sendEmailVerification(auth.currentUser); message('Confirmação reenviada. Confira a caixa de entrada e o spam.'); }
  catch (e) { message(friendlyError(e), 'error'); }
  finally { setBusy(false); }
});
$('#signupLogout').addEventListener('click', async () => {
  if (busy) return;
  try { await logout(); }
  catch (e) { message(friendlyError(e), 'error'); }
});
onAuthStateChanged(auth, checkAccount);
