// ═══════════════════════════════════════════════════════
// EduSpace.tj — Frontend App
// ═══════════════════════════════════════════════════════

const API = 'https://eduspacetj-production.up.railway.app/api';

// ─── HTTP helpers ─────────────────────────────────────
async function req(method, url, data = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    const token = localStorage.getItem('token');
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (data) opts.body = JSON.stringify(data);
    const res = await fetch(API + url, opts);
    const json = await res.json();
    if (!res.ok) throw { status: res.status, message: json.error || 'Ошибка' };
    return json;
}
const get = (url) => req('GET', url);
const post = (url, data) => req('POST', url, data);
const put = (url, data) => req('PUT', url, data);

async function upload(url, formData) {
    const token = localStorage.getItem('token');
    const res = await fetch(API + url, {
        method: 'POST',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw { status: res.status, message: json.error };
    return json;
}

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let regRole = 's', regData = {};
let regTimer, regSec = 59;
let topupAmt = 1000;
let pendingCourseId = null;
let currentProfileId = null;
let setupTp = 'pro';
let acLc = 1;

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
    if (currentUser) {
        try {
            const fresh = await get('/auth/me');
            currentUser = { ...currentUser, ...fresh };
            localStorage.setItem('user', JSON.stringify(currentUser));
            showLoggedIn();
        } catch {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            currentUser = null;
        }
    }
    go('home');
    loadHomeStats();
}

// ═══════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════
function go(p) {
    document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
    document.getElementById('page-' + p)?.classList.add('active');
    ['home','catalog','about'].forEach(x => document.getElementById('nl-'+x)?.classList.remove('active'));
    if (['home','catalog','about'].includes(p)) document.getElementById('nl-'+p)?.classList.add('active');
    window.scrollTo(0, 0);
    if (p === 'catalog') loadCatalog();
    if (p === 'home') loadHomeStats();
}

function goDash() {
    if (!currentUser) { go('login'); return; }
    if (currentUser.role === 'teacher') { go('teacher-dash'); loadTeacherDash(); }
    else { go('student-dash'); loadStudentDash(); }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    currentUser = null;
    document.getElementById('nav-guest').style.display = '';
    document.getElementById('nav-user').style.display = 'none';
    go('home');
}

function showLoggedIn() {
    document.getElementById('nav-guest').style.display = 'none';
    document.getElementById('nav-user').style.display = 'flex';
    setAvatar(document.getElementById('nav-av'), currentUser);
    document.getElementById('nav-uname').textContent = currentUser.firstName + ' ' + (currentUser.lastName?.[0] || '') + '.';
    if (currentUser.role === 'student') {
        document.getElementById('nav-bal-disp').textContent = (currentUser.balance || 0) + ' смн';
    } else {
        document.getElementById('nav-bal-disp').textContent = currentUser.subject || 'Преподаватель';
    }
}

// ═══════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════
async function loadHomeStats() {
    try {
        const [teachers, courses] = await Promise.all([get('/teachers'), get('/courses')]);
        document.getElementById('hs-teachers').innerHTML = teachers.length + '<span>+</span>';
        document.getElementById('hs-courses').innerHTML = courses.length + '<span>+</span>';
        const preview = document.getElementById('home-teachers-preview');
        if (!teachers.length) {
            preview.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text3)">Преподаватели появятся здесь после регистрации</div>';
        } else {
            preview.innerHTML = teachers.slice(0, 3).map(buildTccard).join('');
        }
    } catch(e) { console.log('loadHomeStats error:', e); }
}

// ═══════════════════════════════════════════════════════
// CATALOG
// ═══════════════════════════════════════════════════════
let catalogTeachers = [], catalogCourses = [];

async function loadCatalog(searchQ = '') {
    try {
        const params = searchQ ? `?search=${encodeURIComponent(searchQ)}` : '';
        const [teachers, courses] = await Promise.all([get('/teachers' + params), get('/courses' + params)]);
        catalogTeachers = teachers;
        catalogCourses = courses;
        document.getElementById('cat-count').textContent = teachers.length;
        document.getElementById('tab-t-cnt').textContent = teachers.length;
        document.getElementById('tab-c-cnt').textContent = courses.length;
        const grid = document.getElementById('tc-grid');
        const empty = document.getElementById('cat-empty');
        if (!teachers.length) { grid.innerHTML = ''; empty.style.display = 'block'; }
        else { empty.style.display = 'none'; grid.innerHTML = teachers.map(buildTccard).join(''); }
        const cgrid = document.getElementById('cat-cg');
        const cempty = document.getElementById('cat-c-empty');
        if (!courses.length) { cgrid.innerHTML = ''; cempty.style.display = 'block'; }
        else { cempty.style.display = 'none'; cgrid.innerHTML = courses.map(buildCcard).join(''); }
    } catch(e) { console.error('loadCatalog error:', e); }
}

function catSearch(q) { loadCatalog(q); }

async function sortTeachers(v) {
    try {
        const teachers = await get('/teachers?sort=' + v);
        document.getElementById('tc-grid').innerHTML = teachers.map(buildTccard).join('');
    } catch(e) {}
}

function catTab(tab, btn) {
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('on')); btn.classList.add('on');
    document.getElementById('cat-t-sec').style.display = tab === 't' ? '' : 'none';
    document.getElementById('cat-c-sec').style.display = tab === 'c' ? '' : 'none';
}
function togChip(btn) {
    const isAll = btn.textContent.trim() === 'Все';
    if (isAll) { btn.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); btn.classList.add('on'); }
    else { btn.parentElement.querySelector('.chip:first-child')?.classList.remove('on'); btn.classList.toggle('on'); if (!btn.parentElement.querySelector('.chip.on')) btn.parentElement.querySelector('.chip:first-child').classList.add('on'); }
}
function resetFlt() { document.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); document.querySelectorAll('.flt-grp .chip:first-child').forEach(c => c.classList.add('on')); loadCatalog(); }

// ═══════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════
async function openProfile(id) {
    currentProfileId = id;
    try {
        const t = await get('/teachers/' + id);
        renderProfile(t);
        go('profile');
    } catch(e) { alert('Не удалось загрузить профиль'); console.error(e); }
}

function renderProfile(t) {
    // Breadcrumb
    document.getElementById('pp-bc-name').textContent = t.fullName;

    // Cover background - blurred avatar
    var coverBg = document.getElementById('pp-cover-bg');
    if (coverBg && t.avatarUrl) {
        coverBg.style.backgroundImage = 'url(' + t.avatarUrl + ')';
    } else if (coverBg) {
        coverBg.style.background = 'linear-gradient(135deg,' + (t.color||'#18A96A') + '44,' + (t.color||'#18A96A') + '22)';
    }

    // Avatar
    var av = document.getElementById('pp-av');
    if (av) {
        if (t.avatarUrl) {
            av.style.padding = '0';
            av.style.fontSize = '0';
            av.innerHTML = '<img src="' + t.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;display:block">';
        } else {
            av.textContent = t.initials || '?';
            av.style.background = t.color || '#18A96A';
        }
    }

    // Name & subject
    document.getElementById('pp-hname').textContent = t.fullName;
    document.getElementById('pp-hsubj').textContent = (t.subject || '') + (t.isModerated ? ' · ✓ Проверен' : '');

    // Stats
    document.getElementById('pp-hrat').textContent = t.rating > 0 ? t.rating.toFixed(1) : '—';
    document.getElementById('pp-hrev').textContent = t.reviewCount || 0;
    document.getElementById('pp-hstu').textContent = t.studentCount || 0;
    document.getElementById('pp-hcou').textContent = (t.courses||[]).length;

    // Price card
    document.getElementById('ppc-price').textContent = t.price > 0 ? t.price : '—';
    document.getElementById('ppc-note').textContent = t.price > 0 ? 'Первый урок бесплатно' : 'Свяжитесь с преподавателем';

    // About
    document.getElementById('pp-desc-txt').textContent = t.bio || 'Описание не добавлено';

    // Platforms
    var platMap = {zoom:'Zoom',meet:'Google Meet',teams:'MS Teams',tg:'Telegram',sk:'Skype'};
    var platIcons = {zoom:'🎥',meet:'📹',teams:'💼',tg:'✈️',sk:'💬'};
    document.getElementById('pp-plats').innerHTML = ['zoom','meet','teams','tg','sk'].map(function(p) {
        var on = (t.platforms||[]).indexOf(p) !== -1;
        return '<div class="plat-chip' + (on?' on':'') + '">' + (platIcons[p]||'') + ' ' + platMap[p] + '</div>';
    }).join('');

    // Days
    document.getElementById('pp-days').innerHTML = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(function(d) {
        var on = (t.workDays||[]).indexOf(d) !== -1;
        return '<div class="day-chip' + (on?' on':'') + '">' + d + '</div>';
    }).join('');
    document.getElementById('pp-hours').innerHTML = t.workHours ? '⏰ ' + t.workHours : '';

    // Courses
    document.getElementById('pp-cg').innerHTML = (t.courses||[]).length
        ? t.courses.map(function(c) {
            return '<div class="pp-cc">' +
                '<div style="font-size:28px;margin-bottom:8px">' + (c.emoji||'📖') + '</div>' +
                '<div style="font-size:14px;font-weight:700;margin-bottom:4px">' + c.title + '</div>' +
                '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:10px"><span>' + c.level + '</span><span style="background:var(--gl2);color:var(--g2);padding:2px 7px;border-radius:6px">' + c.category + '</span></div>' +
                '<div style="font-size:16px;font-weight:800;color:var(--g2);margin-bottom:8px">' + (c.price > 0 ? c.price + ' смн' : 'Договорная') + '</div>' +
                '<button class="pp-cc-btn" onclick="startEnroll(\'' + c.id + '\')">Записаться</button>' +
                '</div>';
        }).join('')
        : '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text3)">Курсов пока нет</div>';

    // Reviews
    document.getElementById('pp-rev-big').textContent = t.rating > 0 ? t.rating.toFixed(1) : '—';
    document.getElementById('pp-rev-stars').textContent = t.rating > 0 ? '★'.repeat(Math.round(t.rating)) : '';
    document.getElementById('pp-rev-total').textContent = (t.reviews||[]).length + ' отзывов';
    renderRevList(t.reviews || [], 0);

    // Documents
    document.getElementById('pp-docs-list').innerHTML = (t.documents||[]).length
        ? t.documents.map(function(d) {
            return '<div class="doc-row">' +
                '<div class="doc-ico">' + (d.type==='diploma'?'🎓':d.type==='certificate'?'📜':'📋') + '</div>' +
                '<div class="doc-info"><div class="doc-type-lbl">' + (d.type==='diploma'?'Диплом':d.type==='certificate'?'Сертификат':'Трудовая') + '</div>' +
                '<div class="doc-name">' + d.name + '</div>' +
                '<div class="doc-meta">' + (d.institution||'') + (d.year?' · '+d.year:'') + '</div></div>' +
                '<span class="doc-ok-badge">' + (d.isVerified?'✓ Проверен':'⏳ На проверке') + '</span>' +
                '</div>';
        }).join('')
        : '<div style="text-align:center;padding:2rem;color:var(--text3)">Документы не загружены</div>';

    // Video section
    var videoSec = document.getElementById('pp-video-section');
    var videoContainer = document.getElementById('pp-video-container');
    if (videoSec && videoContainer && t.videoUrl) {
        videoSec.style.display = 'block';
        var embedUrl = t.videoUrl;
        // Convert YouTube URL to embed
        if (embedUrl.includes('youtube.com/watch')) {
            var vid = embedUrl.split('v=')[1];
            if (vid) vid = vid.split('&')[0];
            embedUrl = 'https://www.youtube.com/embed/' + vid;
        } else if (embedUrl.includes('youtu.be/')) {
            var vid = embedUrl.split('youtu.be/')[1];
            if (vid) vid = vid.split('?')[0];
            embedUrl = 'https://www.youtube.com/embed/' + vid;
        } else if (embedUrl.includes('vimeo.com/')) {
            var vid = embedUrl.split('vimeo.com/')[1];
            embedUrl = 'https://player.vimeo.com/video/' + vid;
        }
        videoContainer.innerHTML = '<iframe src="' + embedUrl + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe>';
    } else if (videoSec) {
        videoSec.style.display = 'none';
    }

    // Reset tabs
    document.querySelectorAll('.pp-tab').forEach(function(t,i){ t.classList.toggle('on', i===0); });
    ['pp-about','pp-courses','pp-reviews','pp-docs'].forEach(function(id,i){
        document.getElementById(id).style.display = i===0 ? '' : 'none';
    });
}

function renderRevList(reviews, months) {
    const now = new Date();
    const fl = months === 0 ? reviews : reviews.filter(r => (now - new Date(r.date)) / (1000*60*60*24*30) <= months);
    document.getElementById('pp-rev-list').innerHTML = fl.length ?
        fl.map(r => `
          <div class="ri-card">
            <div class="ri-top">
              <div class="ri-av" style="background:${r.student?.color||'#18A96A'}">${r.student?.initials||'?'}</div>
              <div class="ri-meta"><div class="ri-name">${r.student?.name||'Ученик'}</div><div class="ri-sub">${new Date(r.date).toLocaleDateString('ru',{day:'numeric',month:'long',year:'numeric'})} · ${r.courseTitle||''}</div></div>
              <div class="ri-stars">${'★'.repeat(r.stars)}</div>
            </div>
            <div class="ri-text">${r.text||''}</div>
            ${(r.tags||[]).length ? '<div class="ri-tags">'+r.tags.map(tag=>`<span class="ri-tag">${tag}</span>`).join('')+'</div>' : ''}
          </div>`).join('') :
        '<div style="text-align:center;padding:2rem;color:var(--text3)">Отзывов пока нет</div>';
}

function fltRev(btn, m) {
    document.querySelectorAll('.rp-btn').forEach(b => b.classList.remove('on')); btn.classList.add('on');
    if (!currentProfileId) return;
    get('/teachers/' + currentProfileId).then(t => renderRevList(t.reviews || [], m)).catch(()=>{});
}

function ppTab(tab, btn) {
    document.querySelectorAll('.pp-tab').forEach(t => t.classList.remove('on')); btn.classList.add('on');
    ['pp-about','pp-courses','pp-reviews','pp-docs'].forEach(id => document.getElementById(id).style.display = 'none');
    document.getElementById(tab).style.display = '';
}

async function toggleFavTeacher() {
    if (!currentUser) { go('login'); return; }
    try {
        const result = await post('/users/favorites/' + currentProfileId);
        const saved = result.saved;
        document.getElementById('pp-top-fav').textContent = saved ? '❤️ Сохранено' : '♡ Сохранить';
        document.getElementById('pp-fav-btn').classList.toggle('saved', saved);
        document.getElementById('pp-fav-btn').textContent = saved ? '❤️' : '♡';
    } catch(e) { console.error(e); }
}

function startEnroll(courseId) {
    if (!currentUser) { go('login'); return; }
    if (currentUser.role === 'teacher') { alert('Преподаватели не могут записываться на курсы'); return; }
    pendingCourseId = courseId;
    go('student-dash'); loadStudentDash(); sdShow('payment-flow');
}

function goPayForProfileById(id) {
    currentProfileId = id;
    goPayForProfile();
}

function goPayForProfile() {
    if (!currentUser) { go('login'); return; }
    if (currentUser.role === 'teacher') { alert('Преподаватели не могут записываться на курсы'); return; }
    get('/teachers/' + currentProfileId).then(t => {
        if (t.courses?.length) { pendingCourseId = t.courses[0].id; go('student-dash'); loadStudentDash(); sdShow('payment-flow'); }
        else alert('У этого преподавателя пока нет курсов');
    }).catch(()=>{});
}

// ═══════════════════════════════════════════════════════
// AUTH — REGISTER
// ═══════════════════════════════════════════════════════
function setRegRole(r) {
    regRole = r;
    document.getElementById('rt-s').classList.toggle('on', r === 's');
    document.getElementById('rt-t').classList.toggle('on', r === 't');
    document.getElementById('t-extra').style.display = r === 't' ? 'block' : 'none';
}

function regStep2() {
    const fn = document.getElementById('r-fn').value.trim();
    const ln = document.getElementById('r-ln').value.trim();
    const ph = document.getElementById('r-ph').value.trim();
    const em = document.getElementById('r-em').value.trim();
    const p1 = document.getElementById('r-pw').value;
    const p2 = document.getElementById('r-pw2').value;
    if (!fn || !ln || !ph || !em || !p1) { alert('Заполните все поля'); return; }
    if (p1 !== p2) { document.getElementById('pw-err').style.display = 'block'; return; }
    document.getElementById('pw-err').style.display = 'none';
    if (p1.length < 8) { alert('Пароль минимум 8 символов'); return; }
    regData = { firstName: fn, lastName: ln, phone: ph, email: em, password: p1, role: regRole === 's' ? 'student' : 'teacher', subject: document.getElementById('r-sub')?.value || '' };
    document.getElementById('sms-ph').textContent = '+992 ' + ph;
    document.getElementById('rs1').style.display = 'none';
    document.getElementById('rs2').style.display = 'block';
    document.getElementById('reg-sub').textContent = 'Шаг 2 из 3 — Подтверждение';
    document.getElementById('ss1').classList.add('done');
    document.getElementById('s0').focus();
    startTimer();
}

function smsIn(el, idx) {
    el.classList.toggle('filled', el.value !== '');
    if (el.value && idx < 3) document.getElementById('s' + (idx+1)).focus();
    const code = [0,1,2,3].map(i => document.getElementById('s'+i).value).join('');
    if (code.length === 4) setTimeout(verifySMS, 200);
}

async function verifySMS() {
    const code = [0,1,2,3].map(i => document.getElementById('s'+i).value).join('');
    if (code.length < 4) { document.getElementById('sms-err').style.display = 'block'; return; }
    document.getElementById('sms-err').style.display = 'none';
    clearInterval(regTimer);
    try {
        const result = await post('/auth/register', regData);
        localStorage.setItem('token', result.token);
        localStorage.setItem('user', JSON.stringify(result.user));
        currentUser = result.user;
        document.getElementById('rs2').style.display = 'none';
        document.getElementById('rs3').style.display = 'block';
        document.getElementById('reg-sub').textContent = 'Готово!';
        document.getElementById('ss2').classList.add('done');
        document.getElementById('suc-role').textContent = regData.role === 'student' ? 'Ученик' : 'Преподаватель';
    } catch(e) {
        document.getElementById('sms-err').style.display = 'block';
        document.getElementById('sms-err').textContent = e.message || 'Ошибка регистрации';
    }
}

function backReg() {
    document.getElementById('rs2').style.display = 'none';
    document.getElementById('rs1').style.display = 'block';
    document.getElementById('ss1').classList.remove('done');
    clearInterval(regTimer);
}

function startTimer() {
    regSec = 59; clearInterval(regTimer);
    document.getElementById('tmr-txt').textContent = '0:59';
    regTimer = setInterval(() => {
        regSec--;
        document.getElementById('tmr-txt').textContent = '0:' + (regSec < 10 ? '0' : '') + regSec;
        if (regSec <= 0) clearInterval(regTimer);
    }, 1000);
}

function afterReg() {
    showLoggedIn();
    ['r-fn','r-ln','r-ph','r-em','r-pw','r-pw2'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    [0,1,2,3].forEach(i => { const s=document.getElementById('s'+i); if(s){s.value='';s.classList.remove('filled');} });
    document.getElementById('rs1').style.display = 'block';
    document.getElementById('rs2').style.display = 'none';
    document.getElementById('rs3').style.display = 'none';
    document.getElementById('ss1').classList.remove('done');
    document.getElementById('ss2').classList.remove('done');
    setRegRole('s');
    if (currentUser.role === 'teacher') go('setup');
    else { go('student-dash'); loadStudentDash(); }
}

// ═══════════════════════════════════════════════════════
// AUTH — LOGIN
// ═══════════════════════════════════════════════════════
async function doLogin() {
    const em = document.getElementById('l-em').value.trim();
    const pw = document.getElementById('l-pw').value;
    try {
        const result = await post('/auth/login', { email: em, password: pw });
        localStorage.setItem('token', result.token);
        localStorage.setItem('user', JSON.stringify(result.user));
        currentUser = result.user;
        document.getElementById('l-err').style.display = 'none';
        document.getElementById('l-em').value = '';
        document.getElementById('l-pw').value = '';
        showLoggedIn();
        goDash();
    } catch(e) {
        document.getElementById('l-err').style.display = 'block';
        document.getElementById('l-err').textContent = e.message || 'Неверный email или пароль';
    }
}

// ═══════════════════════════════════════════════════════
// TEACHER SETUP
// ═══════════════════════════════════════════════════════
function setTp(t) { setupTp=t; document.getElementById('tp-pro').classList.toggle('on',t==='pro'); document.getElementById('tp-spec').classList.toggle('on',t==='spec'); }
function setDoc(d) { ['dip','cert','work'].forEach(x => { document.getElementById('dt-'+x)?.classList.toggle('on',x===d); document.getElementById('doc-'+x).style.display=x===d?'block':'none'; }); }
function prevPhoto(input) { if(input.files?.[0]){const r=new FileReader();r.onload=e=>{const img=document.getElementById('setup-ph-img');img.src=e.target.result;img.style.display='block';document.getElementById('setup-ph-ico').style.display='none';};r.readAsDataURL(input.files[0]);} }
function prevFile(input,type){if(input.files?.[0]){document.getElementById('fn-'+type).textContent=input.files[0].name;document.getElementById('fp-'+type).style.display='flex';}}
function rmFile(type){document.getElementById('fn-'+type).textContent='';document.getElementById('fp-'+type).style.display='none';}
function goSetup(n){
    [1,2,3,4,5].forEach(i=>document.getElementById('setup'+i).style.display=i===n?'block':'none');
    for(let i=1;i<=4;i++){const c=document.getElementById('pc'+i),l=document.getElementById('pl'+i);if(i<n){c.textContent='✓';c.classList.add('on');l.classList.add('on');}else if(i===n){c.textContent=i;c.classList.add('on');l.classList.add('on');}else{c.textContent=i;c.classList.remove('on');l.classList.remove('on');}const ln=document.getElementById('pln'+i);if(ln)ln.classList.toggle('done',i<n);}
}
function setupComm(){const p=parseInt(document.getElementById('s-price').value)||0;if(p>0){document.getElementById('sc-sum').textContent=Math.round(p*0.15);document.getElementById('sc-earn').textContent=Math.round(p*0.85);document.getElementById('setup-comm').style.display='flex';}else document.getElementById('setup-comm').style.display='none';}
function togPs(id){const el=document.getElementById('ps-'+id);el.classList.toggle('on');el.querySelector('.ps-ck').textContent=el.classList.contains('on')?'✓':'';}

async function finishSetup() {
    const platforms = ['zoom','meet','teams','tg','sk'].filter(id => document.getElementById('ps-'+id)?.classList.contains('on'));
    const days = Array.from(document.querySelectorAll('#setup4 .day-btn.on')).map(b => b.textContent);
    const timeFrom = document.getElementById('s-time-from')?.value || '09:00';
    const timeTo = document.getElementById('s-time-to')?.value || '20:00';
    const bio = document.getElementById('s-bio')?.value || '';
    const tags = (document.getElementById('s-tags')?.value || '').split(',').map(t=>t.trim()).filter(Boolean);
    const price = parseFloat(document.getElementById('s-price')?.value) || 0;
    const courseName = document.getElementById('s-course-name')?.value || '';
    const courseCat = document.getElementById('s-course-cat')?.value || '';
    const courseLvl = document.getElementById('s-course-lvl')?.value || 'Начинающий';
    const courseDesc = document.getElementById('s-course-desc')?.value || '';
    try {
        await put('/teachers/profile/update', { bio, tags, price, platforms, workDays: days, workHours: timeFrom+'–'+timeTo, teacherType: setupTp });
        const photoInput = document.querySelector('#setup-photo input[type=file]');
        if (photoInput?.files?.[0]) {
            const fd = new FormData(); fd.append('photo', photoInput.files[0]);
            await upload('/teachers/profile/photo', fd);
        }
        const docTypes = ['dip','cert','work'];
        const docTypeMap = {dip:'diploma', cert:'certificate', work:'work_book'};
        for (const dt of docTypes) {
            const inp = document.querySelector(`#doc-${dt} input[type=file]`);
            if (inp?.files?.[0]) {
                const fd = new FormData();
                fd.append('document', inp.files[0]);
                fd.append('docType', docTypeMap[dt]);
                fd.append('docName', inp.files[0].name);
                await upload('/teachers/profile/documents', fd);
            }
        }
        if (courseName && courseCat) {
            const lessons = Array.from(document.querySelectorAll('#ac-lessons .l-title')).map(el => el.textContent);
            await post('/courses', { title: courseName, description: courseDesc, category: courseCat, level: courseLvl, price, lessons });
        }
        goSetup(5);
    } catch(e) { alert('Ошибка: ' + (e.message || 'Неизвестная ошибка')); }
}

// ═══════════════════════════════════════════════════════
// STUDENT DASH
// ═══════════════════════════════════════════════════════
async function loadStudentDash() {
    if (!currentUser) return;
    setAvatar(document.getElementById('sd-av'), currentUser);
    document.getElementById('sd-uname').textContent = currentUser.firstName + ' ' + currentUser.lastName;
    document.getElementById('sd-greet').textContent = currentUser.firstName + '!';
    setAvatar(document.getElementById('settings-av'), currentUser);
    document.getElementById('settings-name').textContent = currentUser.firstName + ' ' + currentUser.lastName;
    document.getElementById('sett-name').value = currentUser.firstName + ' ' + currentUser.lastName;
    document.getElementById('sett-email').value = currentUser.email || '';
    try {
        const [balData, enrollments] = await Promise.all([get('/payments/balance'), get('/payments/enrollments')]);
        currentUser.balance = balData.balance;
        localStorage.setItem('user', JSON.stringify(currentUser));
        showLoggedIn();
        const bal = balData.balance;
        document.getElementById('dh-balance').textContent = bal;
        document.getElementById('dm-balance').textContent = bal;
        document.getElementById('sb-bal-badge').textContent = bal;
        document.getElementById('dh-courses').textContent = enrollments.length;
        document.getElementById('dm-courses').textContent = enrollments.length;
        document.getElementById('sb-courses-cnt').textContent = enrollments.length;
        if (enrollments.length > 0) {
            document.getElementById('sd-courses-preview').innerHTML = enrollments.slice(0,3).map(e =>
                `<div class="d-cr-row"><div class="d-cr-ico">${e.emoji}</div><div class="d-cr-inf"><div class="d-cr-t">${e.title}</div><div class="d-cr-m">${e.first_name} ${e.last_name}</div></div><span class="st-badge2 st-on">Активен</span></div>`
            ).join('');
        }
    } catch(e) { console.error('loadStudentDash:', e); }
    try {
        const notifs = await get('/users/notifications');
        const unread = notifs.filter(n => !n.is_read).length;
        if (unread > 0) { document.getElementById('sb-notif-cnt').textContent = unread; document.getElementById('sb-notif-cnt').style.display = ''; }
        document.getElementById('dm-notifs').textContent = unread;
    } catch(e) {}
}

function sdShow(panel) {
    document.querySelectorAll('[id^="sdp-"]').forEach(p => p.classList.remove('on'));
    document.getElementById('sdp-' + panel)?.classList.add('on');
    if (panel === 'my-courses') loadMyCourses();
    if (panel === 'favorites') loadFavorites();
    if (panel === 'balance') loadBalance();
    if (panel === 'payment-flow') initPayFlow();
    if (panel === 'notifications') loadNotifications();
}

async function loadMyCourses() {
    try {
        const enrollments = await get('/payments/enrollments');
        const el = document.getElementById('sd-my-courses-list');
        if (!enrollments.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">Курсов пока нет</div><div class="empty-sub">Найдите преподавателя в каталоге</div><button class="btn-lg green" onclick="go(\'catalog\')">Найти</button></div>'; return; }
        el.innerHTML = '<div class="cg">' + enrollments.map(e =>
            `<div class="ccard"><div class="ccard-img">${e.emoji}</div><div class="ccard-body"><div class="ccard-cat">${e.category}</div><div class="ccard-title">${e.title}</div><div class="ccard-teacher"><div class="t-dot" style="background:${e.color}">${e.initials}</div>${e.first_name} ${e.last_name}</div></div><div class="ccard-foot"><div class="ccard-price">${e.price} смн</div><button class="ccard-enroll">Продолжить</button></div></div>`
        ).join('') + '</div>';
    } catch(e) { console.error(e); }
}

async function loadFavorites() {
    try {
        const favs = await get('/users/favorites');
        const el = document.getElementById('sd-fav-list');
        if (!favs.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">♡</div><div class="empty-title">Избранное пусто</div><div class="empty-sub">Нажмите ♡ на профиле преподавателя</div><button class="btn-lg green" onclick="go(\'catalog\')">Каталог</button></div>'; return; }
        el.innerHTML = '<div class="tc-grid">' + favs.map(t => buildTccard({
            id: t.id, firstName: t.first_name, lastName: t.last_name, fullName: t.first_name+' '+t.last_name,
            initials: t.initials, color: t.color, subject: t.subject, rating: t.rating, reviewCount: t.review_count, price: t.price
        })).join('') + '</div>';
    } catch(e) { console.error(e); }
}

async function loadBalance() {
    try {
        const bal = await get('/payments/balance');
        document.getElementById('bal-big-disp').innerHTML = parseFloat(bal.balance).toLocaleString('ru') + ' <span>смн</span>';
        document.getElementById('bal-total-disp').textContent = bal.balance + ' смн';
        document.getElementById('bal-spent').textContent = bal.totalSpent + ' смн';
        document.getElementById('bal-added').textContent = bal.totalAdded + ' смн';
        const txns = await get('/payments/history');
        const list = document.getElementById('tx-list');
        if (!txns.length) { list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">Операций пока нет</div>'; return; }
        list.innerHTML = txns.map(t =>
            `<div class="tx-row"><div class="tx-ico" style="background:${t.type==='topup'?'#ECFDF5':'#FEF2F2'}">${t.type==='topup'?'⬆️':'📚'}</div>
            <div class="tx-inf"><div class="tx-name">${t.description}</div><div class="tx-date">${new Date(t.created_at).toLocaleDateString('ru',{day:'numeric',month:'long'})}</div></div>
            <div class="tx-amt ${t.type==='topup'?'plus':'minus'}">${t.type==='topup'?'+':'-'}${t.amount} смн</div>
            <span class="tx-status tx-done">Готово</span></div>`
        ).join('');
    } catch(e) { console.error(e); }
}

async function loadNotifications() {
    try {
        const notifs = await get('/users/notifications');
        await put('/users/notifications/read');
        const el = document.getElementById('notif-list');
        if (!notifs.length) { el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">Уведомлений нет</div>'; return; }
        el.innerHTML = notifs.map(n =>
            `<div class="notif-item"><div class="n-dot${n.is_read?' read':''}"></div><div class="n-text"><strong>${n.title}</strong><br>${n.body||''}</div><div class="n-time">${new Date(n.created_at).toLocaleDateString('ru',{day:'numeric',month:'short'})}</div></div>`
        ).join('');
    } catch(e) { console.error(e); }
}

// ═══════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════
async function saveSettings() {
    const name = document.getElementById('sett-name').value.trim().split(' ');
    try {
        await put('/users/profile', { firstName: name[0], lastName: name.slice(1).join(' ') || currentUser.lastName });
        const fresh = await get('/auth/me');
        currentUser = { ...currentUser, ...fresh };
        localStorage.setItem('user', JSON.stringify(currentUser));
        showLoggedIn();
        alert('✅ Сохранено!');
    } catch(e) { alert('Ошибка: ' + e.message); }
}

async function changePassword() {
    const cur = document.getElementById('sett-cur-pw')?.value;
    const nw  = document.getElementById('sett-new-pw')?.value;
    const cf  = document.getElementById('sett-cf-pw')?.value;
    if (!cur || !nw) return alert('Заполните все поля');
    if (nw.length < 8) return alert('Пароль минимум 8 символов');
    if (nw !== cf) return alert('Пароли не совпадают');
    try {
        await put('/auth/password', { currentPassword: cur, newPassword: nw });
        alert('✅ Пароль изменён!');
        document.getElementById('sett-cur-pw').value = '';
        document.getElementById('sett-new-pw').value = '';
        document.getElementById('sett-cf-pw').value = '';
    } catch(e) { alert('Ошибка: ' + e.message); }
}

function setLang(el) {
    document.querySelectorAll('.lang-opts .lo').forEach(l => l.classList.remove('on'));
    el.classList.add('on');
    alert('Смена языка будет добавлена в следующей версии');
}

// ═══════════════════════════════════════════════════════
// PAYMENT FLOW
// ═══════════════════════════════════════════════════════
async function initPayFlow() {
    document.getElementById('pf-topup').style.display = 'block';
    document.getElementById('pf-checkout').style.display = 'none';
    document.getElementById('pf-success').style.display = 'none';
    try {
        const bal = await get('/payments/balance');
        currentUser.balance = bal.balance;
        updateTopupPreview();
        if (pendingCourseId) {
            document.getElementById('pf-topup').style.display = 'none';
            document.getElementById('pf-checkout').style.display = 'block';
            await renderCheckout(pendingCourseId, bal.balance);
        }
    } catch(e) { console.error(e); }
}

function selAmt(el, amt) {
    document.querySelectorAll('.amt-chip').forEach(c => c.classList.remove('on'));
    if (el) el.classList.add('on');
    else document.querySelectorAll('.amt-chip').forEach(c => { if (parseInt(c.querySelector('.amt-chip-val').textContent.replace(/\s/g,'')) === amt) c.classList.add('on'); });
    topupAmt = amt;
    document.getElementById('custom-amt').value = '';
    updateTopupPreview();
}
function onCustomAmt(v) {
    const amt = parseInt(v) || 0;
    if (amt > 0) { document.querySelectorAll('.amt-chip').forEach(c => c.classList.remove('on')); topupAmt = amt; updateTopupPreview(); }
}
function updateTopupPreview() {
    const bal = currentUser?.balance || 0;
    document.getElementById('topup-preview').textContent = topupAmt.toLocaleString('ru') + ' смн';
    document.getElementById('bal-after-disp').textContent = (bal + topupAmt).toLocaleString('ru') + ' смн';
    document.getElementById('topup-btn-main').textContent = '🔒 Пополнить ' + topupAmt.toLocaleString('ru') + ' смн';
}
function selPayM(el) {
    document.querySelectorAll('.pay-m').forEach(b => b.classList.remove('on')); el.classList.add('on');
    document.getElementById('card-fields').style.display = el.textContent.includes('Карта') ? 'flex' : 'none';
}

async function doTopup() {
    const method = document.querySelector('.pay-m.on')?.textContent?.includes('Телефон') ? 'phone' : document.querySelector('.pay-m.on')?.textContent?.includes('Банк') ? 'bank' : 'card';
    try {
        document.getElementById('topup-btn-main').disabled = true;
        document.getElementById('topup-btn-main').textContent = 'Обработка...';
        const result = await post('/payments/topup', { amount: topupAmt, method });
        currentUser.balance = result.balance;
        localStorage.setItem('user', JSON.stringify(currentUser));
        showLoggedIn();
        updateTopupPreview();
        document.getElementById('topup-btn-main').disabled = false;
        document.getElementById('pf-topup').style.display = 'none';
        document.getElementById('pf-checkout').style.display = 'block';
        if (pendingCourseId) await renderCheckout(pendingCourseId, result.balance);
        else {
            document.getElementById('checkout-courses-list').innerHTML = '<div class="empty-state" style="padding:2rem"><div class="empty-icon">📚</div><div class="empty-title">Баланс пополнен! Выберите курс</div><button class="btn-lg green" onclick="go(\'catalog\')">В каталог</button></div>';
            document.getElementById('pay-btn-main').disabled = true;
        }
    } catch(e) {
        document.getElementById('topup-btn-main').disabled = false;
        document.getElementById('topup-btn-main').textContent = '🔒 Пополнить';
        alert('Ошибка: ' + (e.message||'Попробуйте снова'));
    }
}

async function renderCheckout(courseId, balance) {
    try {
        const c = await get('/courses/' + courseId);
        const ok = balance >= c.price;
        document.getElementById('checkout-courses-list').innerHTML = `
            <div class="checkout-card">
                <div class="co-hdr"><div class="co-emoji">${c.emoji}</div><div><div class="co-title">${c.title}</div><div class="co-teacher">${c.first_name} ${c.last_name}</div></div></div>
                <div class="co-body">
                    <div class="pr-row"><div class="lbl">Цена курса</div><div>${c.price} смн</div></div>
                    <div class="pr-row"><div class="lbl">Комиссия платформы <span class="comm-badge-sm">15%</span></div><div style="color:var(--text3)">-${Math.round(c.price*0.15)} смн</div></div>
                    <div class="pr-row"><div class="lbl">Преподаватель получит</div><div style="color:var(--g2)">${Math.round(c.price*0.85)} смн</div></div>
                    <div class="pr-row total"><div class="lbl">Итого</div><div>${c.price} смн</div></div>
                </div>
            </div>`;
        document.getElementById('bc-ok').style.display = ok ? 'flex' : 'none';
        document.getElementById('bc-err').style.display = ok ? 'none' : 'flex';
        document.getElementById('co-bal').textContent = balance + ' смн';
        document.getElementById('pay-btn-main').disabled = !ok;
        document.getElementById('pay-btn-main').textContent = `Оплатить ${c.price} смн`;
        if (!ok) document.getElementById('shortage-txt').textContent = `Не хватает ${c.price - balance} смн`;
    } catch(e) { console.error(e); }
}

async function doPayCourse() {
    if (!pendingCourseId) return;
    try {
        document.getElementById('pay-btn-main').disabled = true;
        document.getElementById('pay-btn-main').textContent = 'Оплата...';
        const result = await post('/payments/enroll', { courseId: pendingCourseId });
        currentUser.balance = result.newBalance;
        localStorage.setItem('user', JSON.stringify(currentUser));
        showLoggedIn();
        const e = result.enrollment;
        document.getElementById('receipt-rows').innerHTML = `
            <div class="receipt-row"><div class="rl">Курс</div><div class="rv">${e.courseTitle}</div></div>
            <div class="receipt-row"><div class="rl">Сумма</div><div class="rv">${e.pricePaid} смн</div></div>
            <div class="receipt-row"><div class="rl">Комиссия (15%)</div><div class="rv">${e.commissionAmount} смн</div></div>
            <div class="receipt-row"><div class="rl">Преподаватель получил</div><div class="rv g">${e.teacherAmount} смн</div></div>
            <div class="receipt-row"><div class="rl">Ваш баланс</div><div class="rv g">${result.newBalance} смн</div></div>
            <div class="receipt-row"><div class="rl">Дата</div><div class="rv">${new Date().toLocaleDateString('ru',{day:'numeric',month:'long',year:'numeric'})}</div></div>`;
        document.getElementById('pf-checkout').style.display = 'none';
        document.getElementById('pf-success').style.display = 'block';
        pendingCourseId = null;
        loadStudentDash();
    } catch(e) {
        document.getElementById('pay-btn-main').disabled = false;
        document.getElementById('pay-btn-main').textContent = 'Оплатить';
        alert('Ошибка: ' + (e.message||'Попробуйте снова'));
    }
}

function setQuickTopup(amt) { topupAmt = amt; sdShow('payment-flow'); selAmt(null, amt); }

// ═══════════════════════════════════════════════════════
// TEACHER DASH
// ═══════════════════════════════════════════════════════
async function loadTeacherDash() {
    if (!currentUser) return;
    setAvatar(document.getElementById('td-av'), currentUser);
    document.getElementById('td-uname').textContent = currentUser.firstName + ' ' + currentUser.lastName;
    const tdAv = document.getElementById('td-prof-av');
    if (currentUser.avatarUrl) {
        tdAv.style.padding = '0';
        tdAv.style.overflow = 'hidden';
        tdAv.innerHTML = `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
        tdAv.textContent = currentUser.initials;
        tdAv.style.background = currentUser.color;
    }
    document.getElementById('td-prof-name').textContent = currentUser.firstName + ' ' + currentUser.lastName;
    try {
        const [stats, courses] = await Promise.all([get('/teachers/my/stats'), get('/courses/my/list')]);
        document.getElementById('tdm-students').textContent = stats.totalStudents;
        document.getElementById('tdm-courses').textContent = stats.totalCourses;
        document.getElementById('tdm-earn').textContent = stats.netRevenue + ' смн';
        document.getElementById('td-courses-cnt').textContent = courses.length;
        document.getElementById('earn-gross').textContent = stats.grossRevenue + ' смн';
        document.getElementById('earn-comm').textContent = stats.commission + ' смн';
        document.getElementById('earn-net').textContent = stats.netRevenue + ' смн';
        if (courses.length > 0) {
            document.getElementById('td-courses-preview').innerHTML = courses.slice(0,3).map(c =>
                `<div class="d-cr-row"><div class="d-cr-ico">${c.emoji}</div><div class="d-cr-inf"><div class="d-cr-t">${c.title}</div><div class="d-cr-m">${c.category} · ${c.student_count||0} уч. · <span class="st-badge2 ${c.status==='active'?'st-on':'st-rev'}">${c.status==='active'?'Активен':'На проверке'}</span></div></div><div class="d-cr-price">${c.price} смн</div></div>`
            ).join('');
        }
    } catch(e) { console.error('loadTeacherDash:', e); }
    document.getElementById('tp-fname').value = currentUser.firstName || '';
    document.getElementById('tp-lname').value = currentUser.lastName || '';
    document.getElementById('tp-email').value = currentUser.email || '';
    if (document.getElementById('tp-video') && currentUser.videoUrl) {
        document.getElementById('tp-video').value = currentUser.videoUrl || '';
    }
}

function tdShow(panel) {
    document.querySelectorAll('[id^="tdp-"]').forEach(p => p.classList.remove('on'));
    document.getElementById('tdp-' + panel)?.classList.add('on');
    if (panel === 't-courses') loadTeacherCourses();
    if (panel === 't-students') loadTeacherStudents();
}

async function loadTeacherCourses() {
    try {
        const courses = await get('/courses/my/list');
        const el = document.getElementById('td-all-courses');
        if (!courses.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">Курсов пока нет</div><button class="btn-lg green" onclick="tdShow(\'t-add-course\')">Добавить курс</button></div>'; return; }
        el.innerHTML = '<div class="d-card" style="padding:1.2rem">' + courses.map(c =>
            `<div class="d-cr-row"><div class="d-cr-ico">${c.emoji}</div><div class="d-cr-inf"><div class="d-cr-t">${c.title}</div><div class="d-cr-m">${c.category} · ${c.student_count||0} уч. · <span class="st-badge2 ${c.status==='active'?'st-on':'st-rev'}">${c.status==='active'?'Активен':'На проверке'}</span></div></div><div class="d-cr-price">${c.price} смн</div></div>`
        ).join('') + '</div>';
    } catch(e) { console.error(e); }
}

async function loadTeacherStudents() {
    try {
        const students = await get('/teachers/my/students');
        const el = document.getElementById('td-students-list');
        if (!students.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">Учеников пока нет</div></div>'; return; }
        el.innerHTML = '<div class="d-card" style="padding:1.2rem">' + students.map(s =>
            `<div class="d-st-row"><div class="d-st-av" style="background:${s.color||'#18A96A'}">${s.initials||'?'}</div><div style="flex:1"><div style="font-size:13px;font-weight:700">${s.first_name} ${s.last_name}</div><div style="font-size:11px;color:var(--text2)">${s.course_title} · ${new Date(s.enrolled_at).toLocaleDateString('ru',{day:'numeric',month:'short'})}</div></div><div style="font-size:13px;font-weight:700;color:var(--g2)">${s.teacher_amount} смн</div></div>`
        ).join('') + '</div>';
    } catch(e) { console.error(e); }
}

async function saveTeacherProfile() {
    try {
        await put('/teachers/profile/update', {
            firstName: document.getElementById('tp-fname').value,
            lastName: document.getElementById('tp-lname').value,
            subject: document.getElementById('tp-subject').value,
            bio: document.getElementById('tp-bio').value,
            price: parseFloat(document.getElementById('tp-price').value) || 0,
        });
        // Save video URL if provided
        var videoUrl = document.getElementById('tp-video') && document.getElementById('tp-video').value.trim();
        if (videoUrl) {
            try { await post('/teachers/profile/video', { videoUrl: videoUrl }); } catch(ve) { console.log('Video save error:', ve.message); }
        }
        const fresh = await get('/auth/me');
        currentUser = { ...currentUser, ...fresh };
        localStorage.setItem('user', JSON.stringify(currentUser));
        showLoggedIn();
        alert('✅ Профиль сохранён!');
    } catch(e) { alert('Ошибка: ' + e.message); }
}

// ═══════════════════════════════════════════════════════
// ADD COURSE
// ═══════════════════════════════════════════════════════
function addL(){const inp=document.getElementById('ac-les');if(!inp.value.trim())return;acLc++;const div=document.createElement('div');div.className='lesson-item';div.innerHTML=`<div class="l-num">${acLc}</div><div class="l-title">${inp.value}</div><button class="l-del" onclick="delL(this)">✕</button>`;document.getElementById('ac-lessons').appendChild(div);inp.value='';}
function delL(btn){btn.closest('.lesson-item').remove();document.querySelectorAll('#ac-lessons .l-num').forEach((n,i)=>n.textContent=i+1);acLc=document.querySelectorAll('#ac-lessons .lesson-item').length;}
function acComm(){const p=parseInt(document.getElementById('ac-price').value)||0;if(p>0){document.getElementById('ac-cs').textContent=Math.round(p*0.15);document.getElementById('ac-ce').textContent=Math.round(p*0.85);document.getElementById('ac-comm').style.display='flex';}else document.getElementById('ac-comm').style.display='none';}
function acTog(id){const el=document.getElementById('acp-'+id);el.classList.toggle('on');el.querySelector('.ps-ck').textContent=el.classList.contains('on')?'✓':'';}

async function submitCourse() {
    const title = document.getElementById('ac-name').value.trim();
    const cat = document.getElementById('ac-cat').value;
    const price = parseFloat(document.getElementById('ac-price').value) || 0;
    if (!title || !cat || price <= 0) { alert('Заполните название, категорию и цену'); return; }
    const lessons = Array.from(document.querySelectorAll('#ac-lessons .l-title')).map(el => el.textContent);
    try {
        await post('/courses', {
            title, category: cat, level: document.getElementById('ac-lvl').value,
            description: document.getElementById('ac-desc').value, price, lessons,
        });
        const t = document.getElementById('ac-toast'); t.style.display = 'flex';
        setTimeout(() => { t.style.display = 'none'; tdShow('t-courses'); }, 3000);
        ['ac-name','ac-desc','ac-price'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
        acLc = 1; document.getElementById('ac-lessons').innerHTML = '<div class="lesson-item"><div class="l-num">1</div><div class="l-title">Введение и знакомство</div><button class="l-del" onclick="delL(this)">✕</button></div>';
    } catch(e) { alert('Ошибка: ' + e.message); }
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════
function catEmoji(cat) {
    const m={'Математика':'📐','Физика':'⚡','Химия':'⚗️','Биология':'🌿','Английский язык':'🇬🇧','Русский язык':'📝','Таджикский язык':'🇹🇯','IT / Программирование':'💻','Дизайн':'🎨','Бизнес / Маркетинг':'📊'};
    return m[cat] || '📖';
}

function buildTccard(t) {
    var av = t.avatarUrl
        ? '<img src="' + t.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;display:block">'
        : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:#fff;background:' + (t.color||'#18A96A') + '">' + (t.initials||'?') + '</div>';
    var stars = '';
    if (t.rating > 0) {
        var r = Math.round(parseFloat(t.rating));
        for (var i = 0; i < 5; i++) stars += i < r ? '★' : '☆';
    }
    var tags = (t.tags||[]).slice(0,3).map(function(tag){ return '<span class="tc2-tag">' + tag + '</span>'; }).join('');
    var price = t.price > 0 ? '<span class="tc2-price-num">' + t.price + '</span><span class="tc2-price-unit"> смн/мес</span>' : '<span class="tc2-price-num">—</span>';

    return '<div class="tc2card' + (t.isModerated?' verified':'') + '" onclick="openProfile(\'' + t.id + '\')">' +
        '<div class="tc2-photo-wrap">' +
            av +
            (t.isModerated ? '<div class="tc2-check">✓</div>' : '') +
        '</div>' +
        '<div class="tc2-body">' +
            '<div class="tc2-top">' +
                '<div>' +
                    '<div class="tc2-name">' + (t.firstName||t.first_name||'') + ' ' + (t.lastName||t.last_name||'') + '</div>' +
                    '<div class="tc2-subj">' + (t.subject||'Предмет не указан') + '</div>' +
                '</div>' +
                (t.isModerated ? '<span class="tc2-verified-badge">✓ Проверен</span>' : '<span class="tc2-pending-badge">⏳ На проверке</span>') +
            '</div>' +
            (t.bio ? '<div class="tc2-desc">' + t.bio + '</div>' : '') +
            (tags ? '<div class="tc2-tags">' + tags + '</div>' : '') +
            '<div class="tc2-stats">' +
                (t.rating > 0 ? '<span class="tc2-stars">' + stars + ' <strong>' + parseFloat(t.rating).toFixed(1) + '</strong></span>' : '') +
                '<span>👨‍🎓 ' + (t.studentCount||t.student_count||0) + ' учеников</span>' +
                '<span>💬 ' + (t.reviewCount||t.review_count||0) + ' отзывов</span>' +
            '</div>' +
        '</div>' +
        '<div class="tc2-aside">' +
            '<div class="tc2-price">' + price + '</div>' +
            '<button class="tc2-btn-view" onclick="event.stopPropagation();openProfile(\'' + t.id + '\')">Смотреть профиль →</button>' +
            '<button class="tc2-btn-enroll" onclick="event.stopPropagation();goPayForProfileById(\'' + t.id + '\')">Записаться</button>' +
        '</div>' +
    '</div>';
}

function buildCcard(c) {
    return `
        <div class="ccard" onclick="openProfile('${c.teacher?.id||''}')">
            <div class="ccard-img">${c.emoji||'📖'}</div>
            <div class="ccard-body"><div class="ccard-cat">${c.category}</div><div class="ccard-title">${c.title}</div>
            <div class="ccard-teacher"><div class="t-dot" style="background:${c.teacher?.color||'#18A96A'}">${c.teacher?.initials||'?'}</div>${c.teacher?.firstName||''} ${c.teacher?.lastName||''}</div>
            <div class="ccard-meta"><span class="stars">★</span><span style="font-weight:700">${c.rating > 0 ? c.rating.toFixed(1) : '—'}</span></div></div>
            <div class="ccard-foot"><div class="ccard-price">${c.price} смн</div><button class="ccard-enroll" onclick="event.stopPropagation();startEnroll('${c.id}')">Записаться</button></div>
        </div>`;
}


function setAvatar(el, user) {
    if (!el || !user) return;
    if (user.avatarUrl) {
        el.style.padding = '0';
        el.style.overflow = 'hidden';
        el.style.background = user.color || '#18A96A';
        var img = document.createElement('img');
        img.src = user.avatarUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover';
        img.onerror = function() {
            el.innerHTML = user.initials || '?';
            el.style.padding = '';
            el.style.overflow = '';
        };
        el.innerHTML = '';
        el.appendChild(img);
    } else {
        el.innerHTML = user.initials || '?';
        el.style.background = user.color || '#18A96A';
        el.style.padding = '';
        el.style.overflow = '';
    }
}

// ═══════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════

async function uploadTeacherPhoto(input) {
    if (!input.files?.[0]) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) { alert('Файл слишком большой. Максимум 5 МБ'); return; }

    // Preview immediately
    const reader = new FileReader();
    reader.onload = e => {
        const av = document.getElementById('td-prof-av');
        av.style.padding = '0';
        av.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
    };
    reader.readAsDataURL(file);

    // Upload to server
    try {
        const fd = new FormData();
        fd.append('photo', file);
        const result = await upload('/teachers/profile/photo', fd);
        currentUser.avatarUrl = result.avatarUrl;
        localStorage.setItem('user', JSON.stringify(currentUser));
        alert('✅ Фото обновлено!');
    } catch(e) {
        alert('Ошибка загрузки: ' + e.message);
    }
}

init();
