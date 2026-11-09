const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DAYS=['','Mon','Tue','Wed','Thu','Fri','Sat'],TYPES={new:'New student',continuing:'Continuing student',transferee:'Transferee',returnee:'Returnee',irregular:'Irregular student'};
const HINT=['Upload your 4 admission documents to get started.','All documents are in. The registrar will review them next.','The registrar is reviewing. Replace any file marked "Needs changes".','Documents approved. Choose your sections and reserve them.','Sections reserved. Open the Payment tab to settle your fees.','You are officially enrolled. Download your Certificate of Registration from the Payment tab.'];
const CHIP={undefined:['Not uploaded','mute'],pending:['Under review','warn'],approved:['Approved','ok'],rejected:['Needs changes','bad']};
let token=localStorage.getItem('t'),me,secs=[],docs=[],progs=[],pick=new Set(),tab='docs',mode='login',tt;
const dt=x=>new Date(x).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}),mins=t=>{const[h,m]=t.split(':');return h*60+ +m};
const clash=(a,b)=>a.meetings.some(x=>b.meetings.some(y=>x.day===y.day&&mins(x.start)<mins(y.end)&&mins(y.start)<mins(x.end)));

const setTheme=t=>{document.documentElement.dataset.theme=t;localStorage.setItem('th',t);$('#theme').textContent=t==='dark'?'Light mode':'Dark mode'};
setTheme(localStorage.getItem('th')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'));
const toast=(m,err)=>{const t=$('#toast');t.textContent=m;t.className='show'+(err?' err':'');clearTimeout(tt);tt=setTimeout(()=>t.className='',3500)};
async function api(p,o={}){
    const r=await fetch('/api/'+p,{method:o.method||'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:o.body&&JSON.stringify(o.body)});
    const j=await r.json().catch(()=>({}));
    if(r.status===401&&token){logout();throw Error(j.error)}
    if(!r.ok)throw Error(j.error||'Something went wrong.');return j}
async function busy(b,fn){const t=b.textContent;b.disabled=true;b.textContent='Please wait...';try{await fn()}catch(e){toast(e.message,1)}finally{b.disabled=false;b.textContent=t}}
function logout(){localStorage.removeItem('t');token=null;$('#out').hidden=true;authView()}

async function authView(){
    if(!progs.length)progs=await fetch('/api/programs').then(r=>r.json()).catch(()=>[]);
    const reg=mode==='register';
    $('#main').innerHTML=`<div class="auth"><section class="pitch"><h1>Enroll from your phone.<br>No lines. No paper.</h1><p>Upload your documents, reserve your sections and watch your enrollment move forward.</p></section>
  <form class="box"><h2>${reg?'Create your account':'Log in'}</h2>
  ${reg?'<label>Full name<input name="name" autocomplete="name" required></label>':''}
  <label>Email<input name="email" type="email" required autocomplete="email"></label>
  <label>Password<input name="password" type="password" required minlength="8" autocomplete="${reg?'new-password':'current-password'}"></label>
  ${reg?`<label>Program<select name="program_id">${progs.map(p=>`<option value="${p.id}">${esc(p.code)}: ${esc(p.name)}</option>`).join('')}</select></label>
  <label>Student type<select name="student_type">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>`:''}
  <button class="btn" id="go">${reg?'Create account':'Log in'}</button>
  <p><a href="#" id="swap">${reg?'Already have an account? Log in':'New here? Create an account'}</a></p></form></div>`}

async function load(){
    if(!token)return authView();
    try{
        me=await api('me');$('#out').hidden=false;
        if(me.staff)return staffView();
        [secs,docs]=await Promise.all([api('sections'),api('documents')]);pick=new Set(me.section_ids);studentView()
    }catch(e){if(token)toast(e.message,1)}}

function studentView(){
    $('#main').innerHTML=`<section class="hero"><h1>Hi, ${esc(me.full_name.split(' ')[0])}</h1><p>${esc(me.program)}, ${TYPES[me.student_type]}</p>
  <ol class="steps" aria-label="Enrollment progress">${me.stages.map((s,i)=>`<li class="${i+1<me.stage||me.stage===6?'done':i+1===me.stage?'now':''}">${s}</li>`).join('')}</ol>
  <p class="hint">${HINT[me.stage-1]}</p></section>
  <div class="tabs" role="tablist"><button role="tab" data-tab="docs">Documents</button><button role="tab" data-tab="sections">Sections</button><button role="tab" data-tab="pay">Payment</button></div><div class="panel" id="panel"></div>`;
    panel()}
function panel(){document.querySelectorAll('.tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===tab));tab==='docs'?docsPanel():tab==='pay'?payPanel():secsPanel()}

function docsPanel(){
    $('#panel').innerHTML=`<div class="docs">${docs.map(d=>{const[c,k]=CHIP[d.status];return `<div class="doc" data-code="${d.code}">
    <div class="docH"><b>${esc(d.label)}</b><span class="chip ${k}">${c}</span></div>
    <p class="file">${d.original_name?esc(d.original_name):'PDF, JPG or PNG, up to 5 MB'}</p>${d.remarks?`<p class="rem">${esc(d.remarks)}</p>`:''}
    <div class="prog" hidden><i></i></div>
    ${d.status==='approved'?'':`<label class="btn2">${d.status?'Replace file':'Choose file'}<input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden></label>`}</div>`}).join('')}</div>`}

function upload(code,file,card){
    if(!['application/pdf','image/jpeg','image/png'].includes(file.type))return toast('Upload a PDF, JPG or PNG file.',1);
    if(file.size>5*1024*1024)return toast('File must be 5 MB or smaller.',1);
    const x=new XMLHttpRequest(),bar=card.querySelector('.prog');bar.hidden=false;
    x.open('PUT','/api/documents/'+code);x.setRequestHeader('Authorization','Bearer '+token);
    x.setRequestHeader('Content-Type',file.type);x.setRequestHeader('X-Filename',encodeURIComponent(file.name));
    x.upload.onprogress=e=>bar.firstChild.style.width=e.loaded/e.total*100+'%';
    x.onload=async()=>{let j={};try{j=JSON.parse(x.responseText)}catch{}
        x.status<300?toast('Uploaded. The registrar will review it.'):toast(j.error||'Upload failed.',1);await load()};
    x.onerror=()=>{toast('Network problem. Try again.',1);bar.hidden=true};x.send(file)}

function secsPanel(){
    const locked=me.stage<4||me.stage===6,chosen=secs.filter(s=>pick.has(s.id)),units=chosen.reduce((a,s)=>a+s.units,0);
    $('#panel').innerHTML=`${locked?`<p class="note">${me.stage===6?'You are officially enrolled, so your sections are locked.':'Sections open once the registrar approves all four documents. You can look around in the meantime.'}</p>`:''}
  <p>${units} of ${me.max_units} units</p><div class="meter"><i style="width:${Math.min(100,units/me.max_units*100)}%"></i></div>
  ${secs.map(s=>{const on=pick.has(s.id),mine=me.section_ids.includes(s.id);
        const why=on?'':s.missing?'Prerequisite not completed':s.taken-(mine?1:0)>=s.capacity?'Section full':chosen.some(c=>c.course_id===s.course_id)?'Subject already picked'
            :chosen.some(c=>clash(c,s))?'Schedule conflict':units+s.units>me.max_units?'Unit limit reached':'';
        return `<label class="sec ${why||locked?'off':''} ${on?'on':''}"><input type="checkbox" data-id="${s.id}" ${on?'checked':''} ${why||locked?'disabled':''}>
    <div><b>${esc(s.course_code)} section ${esc(s.code)}</b>: ${esc(s.title)}<small>${s.units} units, ${s.meetings.map(m=>`${DAYS[m.day]} ${m.start}-${m.end}`).join(' and ')}, ${s.capacity-s.taken} seats left</small>${why&&!locked?`<em>${why}</em>`:''}</div></label>`}).join('')}
  <div class="bottom"><span>${chosen.length} subjects, ${units} units</span><button class="btn" id="save" ${locked?'disabled':''}>Reserve sections</button></div>`}

async function reviewTab(){
    const[ov,queue]=await Promise.all([api('staff/overview'),api('staff/documents')]);
    const n=Object.fromEntries(['pending','approved','rejected'].map(k=>[k,(ov.docs.find(d=>d.status===k)||{}).n||0])),tot=n.pending+n.approved+n.rejected||1;
    $('#spanel').innerHTML=`
  <div class="tiles">${[['Students',ov.students],['Awaiting review',n.pending],['Approved',n.approved],['Rejected',n.rejected]].map(t=>`<div class="tile"><b>${t[1]}</b><span>${t[0]}</span></div>`).join('')}</div>
  <div class="cols"><div class="c"><h3>Documents by status</h3><div class="stack"><i style="width:${n.approved/tot*100}%;background:var(--ok)"></i><i style="width:${n.pending/tot*100}%;background:var(--warn)"></i><i style="width:${n.rejected/tot*100}%;background:var(--bad)"></i></div>
  <small>Approved ${n.approved}, waiting ${n.pending}, rejected ${n.rejected}</small></div>
  <div class="c"><h3>Section seats</h3>${ov.seats.map(s=>`<div class="bar"><span>${esc(s.course)} ${esc(s.section)}</span><div class="t"><i style="width:${s.taken/s.capacity*100}%"></i></div><em>${s.taken}/${s.capacity}</em></div>`).join('')}</div></div>
  <div class="c" style="margin-bottom:12px"><h3>Review queue</h3>${queue.length?`<div class="tools"><input id="why" placeholder="Reason (needed to reject)"><button class="btn" data-act="approved">Approve selected</button><button class="btn danger" data-act="rejected">Reject selected</button></div>
  <div class="scroll"><table><thead><tr><th><input type="checkbox" id="all" aria-label="Select all"></th><th>Student</th><th>Document</th><th>Uploaded</th><th></th></tr></thead><tbody>
  ${queue.map(d=>`<tr><td><input type="checkbox" class="pk" value="${d.id}" aria-label="Select"></td><td>${esc(d.full_name)}<br><small>${esc(d.program)}</small></td><td>${esc(d.label)}</td><td>${dt(d.uploaded_at)}</td><td><button class="link" data-view="${d.id}">View</button></td></tr>`).join('')}</tbody></table></div>`:'<p>Nothing waiting. New uploads will show up here.</p>'}</div>
  <div class="c log"><h3>Recent activity</h3>${ov.audit.length?ov.audit.map(a=>`<p>${esc(a.full_name)} ${esc(a.action)} ${esc(a.detail)} <small>${dt(a.created_at)}</small></p>`).join(''):'<p>No reviews yet.</p>'}</div>`}

document.addEventListener('click',async e=>{
    const t=e.target.closest('[data-tab],[data-act],[data-view],#swap,#out,#theme,#save');if(!t)return;
    if(t.id==='theme')return setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
    if(t.id==='out')return logout();
    if(t.id==='swap'){e.preventDefault();mode=mode==='login'?'register':'login';return authView()}
    if(t.dataset.tab){tab=t.dataset.tab;const p=$('#panel'),n=p.cloneNode(false);p.replaceWith(n);return panel()}
    if(t.id==='save')return busy(t,async()=>{await api('enroll',{method:'POST',body:{section_ids:[...pick]}});toast('Sections reserved.');await load()});
    if(t.dataset.act)return busy(t,async()=>{
        const ids=[...document.querySelectorAll('.pk:checked')].map(c=>+c.value);if(!ids.length)throw Error('Select at least one document.');
        const r=await api('staff/review',{method:'POST',body:{ids,decision:t.dataset.act,remarks:$('#why').value}});toast(r.updated+' document(s) '+t.dataset.act+'.');await staffView()});
    if(t.dataset.view){const w=window.open('','_blank');
        try{const r=await fetch('/api/staff/documents/'+t.dataset.view+'/file',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw 0;w.location=URL.createObjectURL(await r.blob())}
        catch{w&&w.close();toast('Could not open that file.',1)}}});
document.addEventListener('change',e=>{
    const t=e.target;
    if(t.matches('.doc input[type=file]')&&t.files[0])upload(t.closest('.doc').dataset.code,t.files[0],t.closest('.doc'));
    else if(t.matches('.sec input')){const id=+t.dataset.id;t.checked?pick.add(id):pick.delete(id);secsPanel()}
    else if(t.id==='all')document.querySelectorAll('.pk').forEach(c=>c.checked=t.checked)});
document.addEventListener('submit',e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));
    busy($('#go'),async()=>{const r=await api(mode,{method:'POST',body:mode==='login'?{email:f.email,password:f.password}:f});token=r.token;localStorage.setItem('t',token);await load()})});

// ---------- Phase 3: payments, sections manager, cashier, admin tools ----------
const php=n=>'PHP '+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2});
const ROLE={registrar:'Registrar',cashier:'Cashier',program_head:'Program Head',super_admin:'Super Admin'};
const STAB={review:['Review',['registrar']],sections:['Sections',['registrar','program_head']],payments:['Payments',['cashier']],admin:['Admin tools',['program_head']]};
let stab='review';

async function staffView(){
    const tabs=Object.entries(STAB).filter(([,v])=>v[1].includes(me.role)||me.role==='super_admin');
    if(!tabs.some(([k])=>k===stab))stab=tabs[0][0];
    if(!$('#spanel'))$('#main').innerHTML=`<section class="hero"><h1>Staff dashboard</h1><p>${esc(me.full_name)}, ${ROLE[me.role]}</p></section><div class="tabs" id="stabs" role="tablist"></div><div class="panel" id="spanel"></div>`;
    $('#stabs').innerHTML=tabs.map(([k,v])=>`<button role="tab" data-stab="${k}" aria-selected="${k===stab}">${v[0]}</button>`).join('');
    try{await({review:reviewTab,sections:sectionsTab,payments:payTab,admin:adminTab}[stab])()}catch(e){toast(e.message,1)}}

async function payPanel(){
    let d;try{d=await api('payment')}catch(e){return toast(e.message,1)}
    if(tab!=='pay')return;
    const b=d.bill,p=d.payment,paid=p&&p.status==='paid';
    $('#panel').innerHTML=`${me.stage<5?'<p class="note">Payment opens after you reserve your sections.</p>':''}
  <div class="c"><h3>Fees for ${b.units} units</h3><table><tbody>${b.lines.map(l=>`<tr><td>${esc(l.label)}${l.qty>1?` <small>x ${l.qty}</small>`:''}</td><td style="text-align:right">${php(l.amount)}</td></tr>`).join('')}
  <tr><th>Total</th><th style="text-align:right">${php(b.total)}</th></tr></tbody></table></div>
  ${paid?`<div class="c receipt"><h3>Paid. You are officially enrolled.</h3><p>Reference <span class="ref">${esc(p.reference)}</span> via ${esc(p.method)}, ${php(p.amount)}, ${dt(p.created_at)}</p><button class="btn" data-do="cor">Download Certificate of Registration</button></div>`
        :me.stage===5?`${p?`<p class="note">Show this code to the cashier: <span class="ref">${esc(p.reference)}</span> (${php(p.amount)}). You can still switch to GCash or Maya.</p>`:''}
  <div class="tools pay"><button class="btn" data-do="pay" data-m="gcash">Pay with GCash</button><button class="btn" data-do="pay" data-m="maya">Pay with Maya</button><button class="btn2" data-do="pay" data-m="cashier">Pay at cashier</button></div>`:''}`}

function payModal(m){
    const el=document.createElement('div');el.className='modal';
    el.innerHTML=`<form class="box ${m==='gcash'?'gc':'my'}"><h2>${m==='gcash'?'GCash':'Maya'} checkout</h2><p class="note">Practice checkout. No real money moves.</p>
  <label>Mobile number<input name="mobile" inputmode="numeric" maxlength="11" placeholder="09XXXXXXXXX" required></label>
  <button class="btn">Pay now</button><p><a href="#" data-do="close">Cancel</a></p></form>`;
    el.addEventListener('submit',ev=>{ev.preventDefault();ev.stopPropagation();
        busy(el.querySelector('.btn'),async()=>{await api('payment',{method:'POST',body:{method:m,mobile:el.querySelector('input').value}});el.remove();toast('Payment received.');await load()})});
    document.body.append(el);el.querySelector('input').focus()}

async function sectionsTab(){
    const d=await api('staff/sections');
    $('#spanel').innerHTML=`<div class="c" style="margin-bottom:12px"><h3>Open a new section</h3>
  <div class="tools"><select id="ns-c" aria-label="Subject">${d.courses.map(c=>`<option value="${c.id}">${esc(c.code)}: ${esc(c.title)}</option>`).join('')}</select><input id="ns-cap" type="number" min="1" max="200" value="40" aria-label="Seats"></div>
  <div class="tools days">${[1,2,3,4,5,6].map(i=>`<label><input type="checkbox" class="nd" value="${i}">${DAYS[i]}</label>`).join('')}<input id="ns-s" type="time" value="08:00" aria-label="Start"><input id="ns-e" type="time" value="09:30" aria-label="End"><input id="ns-r" placeholder="Room"></div>
  <button class="btn" data-do="addsec">Add section</button></div>
  <div class="docs">${d.sections.map(s=>`<div class="c">
  <div class="docH"><b>${esc(s.course)} section ${esc(s.code)}</b><small>${s.taken}/${s.capacity} seats</small></div><small>${esc(s.title)}</small>
  <div class="meter"><i style="width:${Math.min(100,s.taken/s.capacity*100)}%"></i></div>
  <small>${s.meetings.map(m=>`${DAYS[m.day]} ${m.ts}-${m.te}`).join(', ')}</small>
  <p>${s.mix.length?s.mix.map(m=>`<span class="chip mute">${TYPES[m.type]} ${m.n}</span>`).join(' '):'<small>No students yet</small>'}</p>
  <div class="tools"><input class="cap" type="number" min="1" max="200" value="${s.capacity}" aria-label="Seats"><button class="btn2" data-do="cap" data-id="${s.id}">Save seats</button><button class="link" data-do="roster" data-id="${s.id}">Students</button></div><div class="roster"></div></div>`).join('')}</div>`}

async function payTab(){
    const d=await api('staff/payments');
    const row=(p,btn)=>`<tr><td>${esc(p.full_name)}<br><small>${esc(p.program)}</small></td><td><span class="ref">${esc(p.reference)}</span></td><td>${php(p.amount)}</td><td>${btn?`<button class="btn" data-do="confirm" data-id="${p.id}">Mark as paid</button>`:esc(p.method)}</td></tr>`;
    $('#spanel').innerHTML=`<div class="tiles"><div class="tile"><b>${php(d.collected)}</b><span>Collected</span></div><div class="tile"><b>${d.paid}</b><span>Paid students</span></div><div class="tile"><b>${d.pending.length}</b><span>Waiting at cashier</span></div></div>
  <div class="c" style="margin-bottom:12px"><h3>Waiting at the cashier</h3>${d.pending.length?`<div class="tools"><input id="find" placeholder="Search name or reference"></div><div class="scroll"><table id="pend"><thead><tr><th>Student</th><th>Reference</th><th>Amount</th><th></th></tr></thead><tbody>${d.pending.map(p=>row(p,1)).join('')}</tbody></table></div>`:'<p>No one is waiting. Students who choose "Pay at cashier" appear here.</p>'}</div>
  <div class="c"><h3>Recent payments</h3>${d.recent.length?`<div class="scroll"><table><tbody>${d.recent.map(p=>row(p,0)).join('')}</tbody></table></div>`:'<p>No payments yet.</p>'}</div>`}

async function adminTab(){
    $('#spanel').innerHTML=`<div class="c" style="margin-bottom:12px"><h3>Student accounts</h3><div class="tools"><input id="uq" placeholder="Search name or email"><button class="btn" data-do="usearch">Search</button></div><div id="ulist"></div></div>
  <div class="c danger-zone"><h3>Reset data</h3><p><small>This cannot be undone. Staff accounts, subjects and sections are kept.</small></p>
  <div class="tools"><input id="rc" placeholder="Type RESET to confirm"></div>
  <div class="tools"><button class="btn danger" data-do="reset" data-scope="enrollments">Clear all enrollments, documents and payments</button><button class="btn danger" data-do="reset" data-scope="all">Delete ALL student accounts</button></div></div>`;
    return users()}
async function users(){
    const l=await api('staff/users?q='+encodeURIComponent($('#uq')?$('#uq').value:''));
    $('#ulist').innerHTML=l.length?`<div class="scroll"><table><tbody>${l.map(u=>`<tr><td>${esc(u.full_name)}<br><small>${esc(u.email)}</small></td><td>${esc(u.program)}<br><small>${TYPES[u.type]}</small></td>
  <td><button class="link" data-do="ureset" data-id="${u.id}">Reset enrollment</button> <button class="link" data-do="udel" data-id="${u.id}" data-n="${esc(u.full_name)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`:'<p>No students found.</p>'}

document.addEventListener('click',e=>{
    const t=e.target.closest('[data-stab],[data-do]');if(!t)return;const a=t.dataset.do,id=t.dataset.id;
    if(t.dataset.stab){stab=t.dataset.stab;const p=$('#spanel');p.replaceWith(p.cloneNode(false));return staffView()}
    if(a==='close'){e.preventDefault();return t.closest('.modal').remove()}
    if(a==='cor'){const w=window.open('','_blank');return busy(t,async()=>{try{const r=await fetch('/api/cor',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error((await r.json()).error);w.location=URL.createObjectURL(await r.blob())}catch(x){w&&w.close();throw x}})}
    if(a==='pay')return t.dataset.m==='cashier'?busy(t,async()=>{await api('payment',{method:'POST',body:{method:'cashier'}});toast('Go to the cashier with your reference code.');await payPanel()}):payModal(t.dataset.m);
    if(a==='addsec')return busy(t,async()=>{await api('staff/sections',{method:'POST',body:{course_id:+$('#ns-c').value,capacity:$('#ns-cap').value,days:[...document.querySelectorAll('.nd:checked')].map(c=>+c.value),start:$('#ns-s').value,end:$('#ns-e').value,room:$('#ns-r').value}});toast('Section added.');await sectionsTab()});
    if(a==='cap')return busy(t,async()=>{await api('staff/sections/'+id,{method:'PATCH',body:{capacity:t.closest('.c').querySelector('.cap').value}});toast('Seats updated.');await sectionsTab()});
    if(a==='roster')return busy(t,async()=>{const r=t.closest('.c').querySelector('.roster');if(r.innerHTML){r.innerHTML='';return}
        const l=await api('staff/sections/'+id+'/students');r.innerHTML=l.length?`<ul>${l.map(s=>`<li>${esc(s.full_name)} <small>${esc(s.program)}, ${TYPES[s.type]}</small></li>`).join('')}</ul>`:'<small>Nobody has reserved this section yet.</small>'});
    if(a==='confirm')return busy(t,async()=>{await api('staff/payments/'+id+'/confirm',{method:'POST'});toast('Payment confirmed.');await payTab()});
    if(a==='usearch')return users().catch(x=>toast(x.message,1));
    if(a==='udel'&&confirm('Delete '+t.dataset.n+' and everything they uploaded?'))return busy(t,async()=>{await api('staff/users/'+id,{method:'DELETE'});toast('Account deleted.');await users()});
    if(a==='ureset'&&confirm("Clear this student's documents, sections and payment?"))return busy(t,async()=>{await api('staff/users/'+id+'/reset',{method:'POST'});toast('Enrollment reset.');await users()});
    if(a==='reset'){const sc=t.dataset.scope;if(!confirm(sc==='all'?'Delete EVERY student account?':'Clear ALL enrollments, documents and payments?'))return;
        return busy(t,async()=>{const r=await api('staff/reset',{method:'POST',body:{scope:sc,confirm:$('#rc').value}});toast('Done. '+r.students+' students affected.');await users()})}});
document.addEventListener('input',e=>{if(e.target.id==='find'){const v=e.target.value.toLowerCase();document.querySelectorAll('#pend tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(v))}});
load();