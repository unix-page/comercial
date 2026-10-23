// Comercial V2 • configuração compartilhada do portal GitHub Pages.
// Chaves de configuração web do Firebase são públicas; permissões pertencem às regras Firestore.
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, onAuthStateChanged, EmailAuthProvider, linkWithCredential } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
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
export const DIVERGENCE_SEED = [
 {id:'fiscal_documentacao',setor:'fiscal',nome:'Documentação fiscal divergente'},
 {id:'fiscal_tributacao',setor:'fiscal',nome:'Divergência tributária'},
 {id:'comercial_sem_xml',setor:'comercial',nome:'Nota sem XML'},
 {id:'comercial_sem_pedido',setor:'comercial',nome:'Nota sem pedido'},
 {id:'comercial_pedido_divergente',setor:'comercial',nome:'Pedido divergente'},
 {id:'comercial_valor',setor:'comercial',nome:'Valor divergente'},
 {id:'cadastro_produto',setor:'cadastro',nome:'Produto não cadastrado'},
 {id:'cadastro_fornecedor',setor:'cadastro',nome:'Fornecedor não cadastrado'}
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
export async function profileFor(user){if(!user)return null;const s=await getDoc(doc(db,'usuarios',user.uid));return s.exists()?{id:s.id,...s.data()}:null;}
export function initAuthUI({onUser, onError=console.error}){
  let lastUid;
  const view=document.getElementById('authScreen'),body=document.getElementById('mainScreen'),status=document.getElementById('authStatus');
  const form=document.getElementById('loginForm');
  form?.addEventListener('submit',async ev=>{ev.preventDefault();try{const fd=new FormData(form);await loginEmail(plain(fd.get('email')),String(fd.get('password')||''));}catch(e){onError(e);}});
  document.getElementById('googleLogin')?.addEventListener('click',async()=>{try{await loginGoogle();}catch(e){onError(e);}});
  document.getElementById('resetLogin')?.addEventListener('click',async()=>{const email=plain(form?.querySelector('[name=email]')?.value);if(!email){onError(new Error('Digite seu e-mail primeiro.'));return;}try{await resetPassword(email);alert('Se a conta permitir recuperação, você receberá as instruções por e-mail.');}catch(e){onError(e);}});
  document.getElementById('logoutButton')?.addEventListener('click',()=>logout().catch(onError));
  document.getElementById('signOutLogin')?.addEventListener('click',()=>logout().catch(onError));
  document.getElementById('setPassword')?.addEventListener('click',async()=>{const p=prompt('Defina uma senha para sua conta Google (mínimo de 8 caracteres):');if(!p)return;if(p.length<8){onError(new Error('Use pelo menos 8 caracteres.'));return;}try{await addPassword(p);alert('Senha vinculada à mesma conta. Você também pode entrar por e-mail.');}catch(e){onError(new Error('Não foi possível vincular: '+(e.code||e.message)+'. Consulte o administrador se o e-mail já tiver outra conta.'));}});
  return onAuthStateChanged(auth,async u=>{
    if(!u){lastUid=null;view?.classList.remove('hidden');body?.classList.add('hidden');if(status)status.textContent='Entre para continuar';await onUser(null,null);return;}
    try{const p=await profileFor(u); if(auth.currentUser?.uid!==u.uid)return;
      if(!activeProfile(p)){view?.classList.remove('hidden');body?.classList.add('hidden');if(status)status.textContent=p?'Conta desativada':'Sem perfil em usuarios (peça acesso ao administrador)';await onUser(u,null);return;}
      view?.classList.add('hidden');body?.classList.remove('hidden');if(status)status.textContent='';lastUid=u.uid;await onUser(u,p);
    }catch(e){onError(e);view?.classList.remove('hidden');body?.classList.add('hidden');}
  });
}
