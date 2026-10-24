// Comercial V2 • configuração compartilhada do portal GitHub Pages.
// Chaves de configuração web do Firebase são públicas; permissões pertencem às regras Firestore.
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendEmailVerification, reload, signOut, sendPasswordResetEmail, onAuthStateChanged, EmailAuthProvider, linkWithCredential } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, where, orderBy, limit, startAfter, serverTimestamp, writeBatch, runTransaction, arrayUnion, increment, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
export { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, where, orderBy, limit, startAfter, serverTimestamp, writeBatch, runTransaction, arrayUnion, increment, onSnapshot, onAuthStateChanged };
const config = {
  apiKey: 'AIzaSyBpWLYK1cejNpUAo5NMk8ecSSQrYMVf6-0',
  authDomain: 'comercial-divergencias.firebaseapp.com',
  projectId: 'comercial-divergencias',
  storageBucket: 'comercial-divergencias.firebasestorage.app',
  messagingSenderId: '602637992147',
  appId: '1:602637992147:web:fc930856cc72f598a31426'
};
const app = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const SECTORS = { fiscal: 'Fiscal (Sicofe)', comercial: 'Comercial', cadastro: 'Cadastro' };
export const BUYERS_SEED = [
 'ADAO AGNELO', 'CAMILA LOVIZARO', 'CAROL MAZIERO', 'DENI MARCOS DE CARVALHO',
 'GISLAINE MACIEL', 'PAULO CESAR SANTANA', 'RAFAEL GOMES', 'REGINALDO S MARTINS',
 'ROSANGELA', 'TATIANA CARDOSO', 'THIAGO HIDEO', 'VALDENIR', 'WAGNER BERLOFFA', 'ZILDA SALICANO'
];
// Catálogos iniciais pequenos e OPT-IN: não são criados automaticamente.
// Nunca apagamos nem sobrescrevemos os tipos já cadastrados.
export const DIVERGENCE_SEED = [
 {setor:'fiscal', nome:'Regra fiscal em desacordo'},
 {setor:'cadastro', nome:'Produto não encontrado'},
 {setor:'comercial', nome:'Nota sem XML'},
 {setor:'comercial', nome:'Nota sem pedido'},
 {setor:'comercial', nome:'Produto sem pedido'},
 {setor:'comercial', nome:'Quantidade divergente'},
 {setor:'comercial', nome:'Valor divergente'}
];
// O efeito é aplicado quando a CRF REGISTRA uma resposta, não pelo fornecedor.
export const RESPONSE_EFFECTS = {
 validar: 'Retornar à CRF para validação',
 concluir: 'Concluir a divergência',
 devolver: 'Devolver / recusar a nota'
};
export const RESPONSE_SEED = [
 {setor:'fiscal',nome:'Informações divergentes (erro da CRF)',efeito:'validar'},
 {setor:'fiscal',nome:'Devolver e recusar',efeito:'devolver'},
 {setor:'fiscal',nome:'Finalizado',efeito:'concluir'},
 {setor:'cadastro',nome:'Informações divergentes (erro da CRF)',efeito:'validar'},
 {setor:'cadastro',nome:'Devolver e recusar',efeito:'devolver'},
 {setor:'cadastro',nome:'Finalizado',efeito:'concluir'},
 {setor:'comercial',nome:'XML baixado',efeito:'validar'},
 {setor:'comercial',nome:'Pedido corrigido',efeito:'validar'},
 {setor:'comercial',nome:'Informações divergentes',efeito:'validar'},
 {setor:'comercial',nome:'Solicitar reentrega',efeito:'validar'},
 {setor:'comercial',nome:'Devolver e recusar',efeito:'devolver'}
];
export const digits = s => String(s ?? '').replace(/\D/g,'');
export const plain = s => String(s ?? '').trim().replace(/\s+/g,' ');
export const canon = s => plain(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
export const slug = s => canon(s).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,88);
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function fmtDate(s) { if(!s)return '—'; const d=typeof s.toDate==='function'?s.toDate():new Date(s);return isNaN(d)?'—':d.toLocaleString('pt-BR'); }
export function millis(s) {return s?.toMillis?.() ?? (s?.seconds ? s.seconds*1000 : (s instanceof Date ? s.getTime() : 0));}
export function fmtDuration(ms) {const m=Math.max(0,Math.floor((ms||0)/60000)); return m>=1440?`${Math.floor(m/1440)}d ${Math.floor(m%1440/60)}h`:`${Math.floor(m/60)}h ${m%60}min`;}
export function validCnpj(str){const n=digits(str);if(n.length!==14||/^(\d)\1{13}$/.test(n))return false;function dv(len){let sum=0,p=len-7;for(let i=0;i<len;i++){sum+=Number(n[i])*p--;if(p<2)p=9;}let r=sum%11;return r<2?0:11-r;}return dv(12)===Number(n[12])&&dv(13)===Number(n[13]);}
export function parseKey(v){const s=digits(v);if(s.length!==44 || /^(\d)\1{43}$/.test(s))return null; let sum=0,p=2;for(let i=42;i>=0;i--){sum+=Number(s[i])*p;p=p===9?2:p+1;}const r=sum%11;const check=r===0||r===1?0:11-r;if(check!==Number(s[43]))return null;return {chave:s,cnpj:s.slice(6,20),numeroNf:String(parseInt(s.slice(25,34),10)),serie:s.slice(22,25),modelo:s.slice(20,22)};}
export function buyerId(name){return 'comprador_'+slug(name);}
export async function loginGoogle(){return signInWithPopup(auth,new GoogleAuthProvider());}
export async function loginEmail(email,password){return signInWithEmailAndPassword(auth,email,password);}
export async function logout(){return signOut(auth);}
export async function resetPassword(email){return sendPasswordResetEmail(auth,email);}
export async function addPassword(password){if(!auth.currentUser?.email)throw new Error('Entre com Google antes de definir uma senha.');const credential=EmailAuthProvider.credential(auth.currentUser.email,password);return linkWithCredential(auth.currentUser,credential);}
export function activeProfile(p){return !!p && p.ativo !== false;}
export function isAdmin(p){return activeProfile(p)&&p.papel==='admin';}
export function canRecord(p){return activeProfile(p)&&['admin','usuario','crf'].includes(p.papel);}
// Cadastro livre: um novo UID só pode criar perfil normal/ativo.
// Para e-mail/senha, exige confirmação do endereço; Google normalmente já chega verificado.
// Perfil de administrador/Compras/Fiscal/Cadastro só é concedido pelo admin existente.
export async function profileFor(user) {
  if (!user) return null;
  const target = doc(db, 'usuarios', user.uid);
  const existing = await getDoc(target);
  if (existing.exists()) return { id: existing.id, ...existing.data() };
  if (!user.email || !user.emailVerified) return null;

  const email = plain(user.email).toLowerCase();
  const suggested = plain(user.displayName || email.split('@')[0]).slice(0, 120);
  const nome = suggested.length >= 2 ? suggested : email.split('@')[0];
  // Transação: não sobrescrever perfis existentes se outra sessão criar primeiro.
  await runTransaction(db, async tx => {
    const current = await tx.get(target);
    if (current.exists()) return;
    tx.set(target, {
      nome, email, papel: 'usuario', ativo: true,
      origem: 'autocadastro', criadoEm: serverTimestamp()
    });
  });
  const result = await getDoc(target);
  return result.exists() ? { id: result.id, ...result.data() } : null;
}
export async function registerEmailAccount(nome, email, password) {
  const cleanName = plain(nome);
  const normalized = plain(email).toLowerCase();
  if (cleanName.length < 2 || cleanName.length > 120) throw new Error('Informe seu nome (2 a 120 caracteres).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error('Informe um e-mail válido.');
  if (String(password).length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');
  const credential = await createUserWithEmailAndPassword(auth, normalized, String(password));
  // O nome acompanha a conta Firebase Auth e será usado no perfil quando verificado.
  await updateProfile(credential.user, { displayName: cleanName });
  await sendEmailVerification(credential.user);
  return credential.user;
}

export async function setPreferredName(nome) {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre com a conta primeiro.');
  const clean = plain(nome).slice(0, 120);
  if (clean.length < 2) throw new Error('Informe um nome com pelo menos 2 caracteres.');
  const target = doc(db, 'usuarios', user.uid);
  const existing = await getDoc(target);
  // Primeiro salvamos o nome no perfil do Comercial; caso o Firestore negue,
  // não deixamos o nome do Firebase Auth alterado pela metade.
  if (existing.exists() && existing.data()?.nome !== clean) {
    try {
      await updateDoc(target, { nome: clean, atualizadoEm: serverTimestamp() });
    } catch (error) {
      if (error?.code === 'permission-denied') {
        throw new Error('O Firestore negou a atualização do nome. Publique o firestore.rules da correção V2.5.4.1 antes de tentar novamente.');
      }
      throw error;
    }
  }
  if (user.displayName !== clean) await updateProfile(user, { displayName: clean });
  return clean;
}

export async function confirmVerifiedEmail() {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre na conta cadastrada para verificar seu e-mail.');
  await reload(user);
  await user.getIdToken(true);
  if (!user.emailVerified) throw new Error('E-mail ainda não confirmado. Abra a mensagem de verificação e clique no link.');
  return user;
}

export function initAuthUI({onUser, onError=console.error}) {
  const view = document.getElementById('authScreen');
  const body = document.getElementById('mainScreen');
  const status = document.getElementById('authStatus');
  const form = document.getElementById('loginForm');
  const updateStatus = value => { if (status) status.textContent = value; };
  let working = false;

  async function displayUser(u) {
    if (!u) {
      view?.classList.remove('hidden');
      body?.classList.add('hidden');
      updateStatus('Entre para continuar');
      await onUser(null, null);
      return;
    }
    try {
      const profile = await profileFor(u);
      if (auth.currentUser?.uid !== u.uid) return;
      if (!activeProfile(profile)) {
        view?.classList.remove('hidden');
        body?.classList.add('hidden');
        updateStatus(profile
          ? 'Conta desativada. Peça autorização ao administrador.'
          : (!u.emailVerified
              ? `Confirme seu e-mail (${u.email || 'não informado'}) para ativar o cadastro.`
              : 'Não foi possível criar seu perfil. Consulte o administrador.'));
        await onUser(u, null);
        return;
      }
      view?.classList.add('hidden');
      body?.classList.remove('hidden');
      updateStatus('');
      await onUser(u, profile);
    } catch (e) {
      onError(e);
      view?.classList.remove('hidden');
      body?.classList.add('hidden');
      updateStatus('Não foi possível conferir seu acesso. Confira a conexão e as regras.');
    }
  }

  form?.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (working) return;
    working = true;
    try {
      const data = new FormData(form);
      await loginEmail(plain(data.get('email')), String(data.get('password') || ''));
    } catch (e) { onError(e); }
    finally { working = false; }
  });
  document.getElementById('googleLogin')?.addEventListener('click', async () => {
    if (working) return;
    working = true;
    try { await loginGoogle(); } catch(e) { onError(e); }
    finally { working = false; }
  });
  document.getElementById('verifyEmail')?.addEventListener('click', async () => {
    if (working) return;
    working = true;
    try { const u = await confirmVerifiedEmail(); await displayUser(u); }
    catch(e) { onError(e); }
    finally { working = false; }
  });
  document.getElementById('resendVerification')?.addEventListener('click', async () => {
    try {
      if (!auth.currentUser) throw new Error('Entre com a conta primeiro.');
      if (auth.currentUser.emailVerified) throw new Error('Este e-mail já está verificado.');
      await sendEmailVerification(auth.currentUser);
      alert('Solicitação enviada. Confira a caixa de entrada e o spam.');
    } catch (e) { onError(e); }
  });
  document.getElementById('resetLogin')?.addEventListener('click', async () => {
    const email = plain(form?.querySelector('[name=email]')?.value);
    if (!email) { onError(new Error('Digite seu e-mail primeiro.')); return; }
    try { await resetPassword(email); alert('Se a conta permitir recuperação, você receberá as instruções por e-mail.'); }
    catch(e) { onError(e); }
  });
  document.getElementById('logoutButton')?.addEventListener('click', () => logout().catch(onError));
  document.getElementById('signOutLogin')?.addEventListener('click', () => logout().catch(onError));
  document.getElementById('setPassword')?.addEventListener('click', async () => {
    const password = prompt('Defina uma senha para sua conta Google (mínimo de 8 caracteres):');
    if (!password) return;
    if (password.length < 8) { onError(new Error('Use pelo menos 8 caracteres.')); return; }
    try { await addPassword(password); alert('Senha vinculada à mesma conta. Você também pode entrar por e-mail.'); }
    catch(e) { onError(new Error('Não foi possível vincular: ' + (e.code || e.message) + '. Consulte o administrador se o e-mail já tiver outra conta.')); }
  });
  return onAuthStateChanged(auth, displayUser);
}
