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

    // Restore page from URL hash
    var hash = window.location.hash.replace('#', '');

    if (hash && hash !== 'home') {
        // Authenticated pages
        if (['student-dash','teacher-dash','course','teacher-student'].includes(hash)) {
            if (currentUser) {
                if (hash === 'student-dash') { go('student-dash', true); loadStudentDash(); return; }
                if (hash === 'teacher-dash') { go('teacher-dash', true); loadTeacherDash(); return; }
            }
            // Not logged in — go home
            go('home', true);
            loadHomeStats();
            return;
        }
        // Public pages
        var publicPages = ['catalog','about','login','register'];
        if (publicPages.includes(hash)) {
            go(hash, true);
            return;
        }
    }

    // Default: if logged in go to dash, else home
    if (currentUser) {
        goDash();
    } else {
        go('home', true);
        loadHomeStats();
    }
}


// ── Навигация инициализируется ниже в go() ──
var _pageHistory = [];

function goBack() {
    if (_pageHistory.length > 1) {
        _pageHistory.pop();
        var prev = _pageHistory[_pageHistory.length - 1];
        go(prev, true);
    }
}

// ═══════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════
function go(p, skipHistory) {
    // Stop course chat polling when leaving course/teacher-student pages
    if (p !== 'course' && p !== 'teacher-student') {
        stopCourseChatPoll();
    }
    document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
    document.getElementById('page-' + p)?.classList.add('active');
    ['home','catalog','about'].forEach(x => {
        document.getElementById('nl-'+x)?.classList.remove('active');
        document.getElementById('mnl-'+x)?.classList.remove('active');
    });
    if (['home','catalog','about'].includes(p)) {
        document.getElementById('nl-'+p)?.classList.add('active');
        document.getElementById('mnl-'+p)?.classList.add('active');
    }
    window.scrollTo(0, 0);
    closeMobileMenu();

    // Save page in URL hash and in our history stack
    if (!skipHistory) {
        var hash = p === 'home' ? '' : '#' + p;
        history.replaceState({ page: p }, '', hash || window.location.pathname);
        // Track in our own history
        if (_pageHistory.length === 0 || _pageHistory[_pageHistory.length - 1] !== p) {
            _pageHistory.push(p);
            if (_pageHistory.length > 20) _pageHistory.shift(); // limit size
        }
    }

    if (p === 'catalog') loadCatalog();
    if (p === 'home') loadHomeStats();
}



// ── Браузерные кнопки Назад / Вперёд ──
window.addEventListener('popstate', function() {
    if (_pageHistory.length > 1) {
        _pageHistory.pop();
        var prev = _pageHistory[_pageHistory.length - 1];
        go(prev, true);
    } else {
        var stay = currentUser
            ? (currentUser.role === 'teacher' ? 'teacher-dash' : 'student-dash')
            : 'home';
        go(stay, true);
        if (currentUser) {
            if (currentUser.role === 'teacher') loadTeacherDash();
            else loadStudentDash();
        } else {
            loadHomeStats();
        }
        history.pushState({ page: stay }, '', stay === 'home' ? '/' : '#' + stay);
    }
});


// Restore page on refresh
function restorePageFromHash() {
    var hash = window.location.hash.replace('#', '');
    if (!hash || hash === 'home') return null;
    var publicPages = ['catalog', 'about', 'login', 'register'];
    if (publicPages.includes(hash)) return hash;
    return null; // protected pages need auth check
}

function goDash() {
    if (!currentUser) { go('login'); return; }
    if (currentUser.role === 'teacher') {
        go('teacher-dash');
        loadTeacherDash();
    } else {
        go('student-dash');
        loadStudentDash();
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    currentUser = null;
    if (typeof teacherPollInterval !== 'undefined' && teacherPollInterval) {
        clearInterval(teacherPollInterval); teacherPollInterval = null;
    }
    if (typeof studentChatPollInterval !== 'undefined' && studentChatPollInterval) {
        clearInterval(studentChatPollInterval); studentChatPollInterval = null;
    }
    stopCourseChatPoll();
    if (chatInterval) { clearInterval(chatInterval); chatInterval = null; }
    document.getElementById('nav-guest').style.display = '';
    document.getElementById('nav-user').style.display = 'none';
    const gEl = document.getElementById('mob-menu-guest');
    const uEl = document.getElementById('mob-menu-user');
    if (gEl) gEl.style.display = '';
    if (uEl) uEl.style.display = 'none';
    closeMobileMenu();
    history.replaceState({page:'home'}, '', window.location.pathname);
    go('home', true);
    loadHomeStats();
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
    // Sync mobile menu
    const gEl = document.getElementById('mob-menu-guest');
    const uEl = document.getElementById('mob-menu-user');
    if (gEl) gEl.style.display = 'none';
    if (uEl) uEl.style.display = 'block';
}

// ═══════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════
async function loadHomeStats() {
    try {
        const [teachers, courses] = await Promise.all([get('/teachers'), get('/courses')]);
        document.getElementById('hs-teachers').innerHTML = teachers.length + '<span>+</span>';
        document.getElementById('hs-courses').innerHTML = courses.length + '<span>+</span>';
        // Count total students from teacher profiles
        const totalStudents = teachers.reduce(function(sum, t){ return sum + (parseInt(t.studentCount || t.student_count) || 0); }, 0);
        const studentsEl = document.getElementById('hs-students');
        if (studentsEl) studentsEl.innerHTML = totalStudents + '<span>+</span>';
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

function catSearch(q) {
    loadCatalog(q);
}
function catSearchKey(e) {
    if (e.key === 'Enter') catSearch(e.target.value.trim());
}

async function sortTeachers(v) {
    try {
        const searchEl = document.getElementById('cat-search-inp');
        const search = searchEl ? searchEl.value.trim() : '';
        const qs = '?sort=' + v + (search ? '&search=' + encodeURIComponent(search) : '');
        const teachers = await get('/teachers' + qs);
        catalogTeachers = teachers;
        document.getElementById('cat-count').textContent = teachers.length;
        document.getElementById('tab-t-cnt').textContent = teachers.length;
        document.getElementById('tc-grid').innerHTML = teachers.map(buildTccard).join('');
    } catch(e) { console.error('sortTeachers:', e); }
}

function catTab(tab, btn) {
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('on')); btn.classList.add('on');
    document.getElementById('cat-t-sec').style.display = tab === 't' ? '' : 'none';
    document.getElementById('cat-c-sec').style.display = tab === 'c' ? '' : 'none';
}
function togChip(btn) {
    const isAll = btn.dataset.val === 'all' || btn.textContent.trim() === 'Все';
    const group = btn.parentElement;
    if (isAll) {
        group.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
        btn.classList.add('on');
    } else {
        group.querySelector('[data-val="all"]')?.classList.remove('on');
        group.querySelector('.chip:first-child')?.classList.remove('on');
        btn.classList.toggle('on');
        if (!group.querySelector('.chip.on')) {
            (group.querySelector('[data-val="all"]') || group.querySelector('.chip:first-child')).classList.add('on');
        }
    }
    // Auto-apply filters immediately — no need to click button
    applyFilters();
}
function resetFlt() {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    document.querySelectorAll('.flt-grp [data-val="all"]').forEach(c => c.classList.add('on'));
    const searchEl = document.getElementById('cat-search-inp');
    if (searchEl) searchEl.value = '';
    document.querySelector('.sort-sel') && (document.querySelector('.sort-sel').value = 'new');
    loadCatalog();
}

function applyFilters() {
    const subjectChips  = [...document.querySelectorAll('#flt-subject .chip.on')].map(c => c.dataset.val).filter(v => v && v !== 'all');
    const levelChips    = [...document.querySelectorAll('#flt-level .chip.on')].map(c => c.dataset.val).filter(v => v && v !== 'all');
    const platformChips = [...document.querySelectorAll('#flt-platform .chip.on')].map(c => c.dataset.val).filter(v => v && v !== 'all');
    const sortEl   = document.querySelector('.sort-sel');
    const sort     = sortEl ? sortEl.value : '';
    const searchEl = document.getElementById('cat-search-inp');
    const search   = searchEl ? searchEl.value.trim() : '';

    let params = [];
    if (search)              params.push('search='   + encodeURIComponent(search));
    if (sort)                params.push('sort='     + sort);
    if (subjectChips.length) params.push('subject='  + encodeURIComponent(subjectChips.join(',')));
    if (levelChips.length)   params.push('level='    + encodeURIComponent(levelChips.join(',')));
    if (platformChips.length)params.push('platform=' + encodeURIComponent(platformChips[0]));

    const qs = params.length ? '?' + params.join('&') : '';
    loadCatalogWithParams(qs);
}

async function loadCatalogWithParams(qs) {
    try {
        const [teachers, courses] = await Promise.all([get('/teachers' + qs), get('/courses' + qs)]);
        catalogTeachers = teachers;
        catalogCourses  = courses;
        document.getElementById('cat-count').textContent = teachers.length;
        document.getElementById('tab-t-cnt').textContent = teachers.length;
        document.getElementById('tab-c-cnt').textContent = courses.length;
        const grid  = document.getElementById('tc-grid');
        const empty = document.getElementById('cat-empty');
        if (!teachers.length) { grid.innerHTML = ''; empty.style.display = 'block'; }
        else { empty.style.display = 'none'; grid.innerHTML = teachers.map(buildTccard).join(''); }
        const cgrid  = document.getElementById('cat-cg');
        const cempty = document.getElementById('cat-c-empty');
        if (!courses.length) { cgrid.innerHTML = ''; cempty.style.display = 'block'; }
        else { cempty.style.display = 'none'; cgrid.innerHTML = courses.map(buildCcard).join(''); }
    } catch(e) { console.error('loadCatalogWithParams error:', e); }
}

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
    var cond = t.conditions || {};
    document.getElementById('ppc-note').textContent = cond.trial ? 'Первый урок бесплатно' : 'Свяжитесь с преподавателем';
    // Show/hide features based on teacher conditions
    var feats = document.getElementById('ppc-feats');
    if (feats) {
        var items = [
            {key:'trial',    ico:'🎁', text:'Пробный урок бесплатно'},
            {key:'homework', ico:'📝', text:'Домашние задания'},
        ];
        feats.innerHTML = items.filter(function(i){ return cond[i.key]; }).map(function(i){
            return '<div class="ppc-feat"><div class="ppc-feat-ico">' + i.ico + '</div>' + i.text + '</div>';
        }).join('') || '<div class="ppc-feat"><div class="ppc-feat-ico">🎥</div>Живые онлайн-занятия</div>';
    }
    // Show/hide trial and guarantee buttons
    var trialBtn = document.querySelector('.btn-trial');
    if (trialBtn) trialBtn.style.display = cond.trial ? '' : 'none';
    var guarEl = document.querySelector('.ppc-guar');
    if (guarEl) guarEl.style.display = 'none';

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
            var ico = d.type==='diploma'?'🎓':d.type==='certificate'?'📜':'📋';
            var typeName = d.type==='diploma'?'Диплом':d.type==='certificate'?'Сертификат':'Трудовая';
            var tag = d.fileUrl ? 'a' : 'div';
            var href = d.fileUrl ? ' href="' + d.fileUrl + '" target="_blank"' : '';
            var openBtn = d.fileUrl
                ? '<div style="font-size:12px;color:#2563EB;font-weight:700;margin-top:3px">👁 Открыть документ →</div>'
                : '<div style="font-size:12px;color:var(--text3);margin-top:3px">Файл недоступен</div>';
            return '<' + tag + href + ' style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg);border-radius:10px;margin-bottom:8px;border:1.5px solid ' + (d.fileUrl ? 'rgba(37,99,235,.2)' : 'var(--border)') + ';text-decoration:none;color:inherit;' + (d.fileUrl ? 'cursor:pointer' : '') + '">' +
                '<div style="font-size:28px">' + ico + '</div>' +
                '<div style="flex:1">' +
                '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">' + typeName + '</div>' +
                '<div style="font-size:14px;font-weight:700;margin:2px 0">' + d.name + '</div>' +
                '<div style="font-size:12px;color:var(--text2)">' + (d.institution || '') + (d.year ? ' · ' + d.year : '') + '</div>' +
                openBtn + '</div>' +
                '</' + tag + '>';
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
        // Check if it's a direct video file (cloudinary) or embed (youtube/vimeo)
        if (embedUrl.includes('cloudinary.com') || embedUrl.includes('.mp4') || embedUrl.includes('.webm')) {
            videoContainer.innerHTML = '<video src="' + embedUrl + '" style="position:absolute;top:0;left:0;width:100%;height:100%" controls></video>';
        } else {
            videoContainer.innerHTML = '<iframe src="' + embedUrl + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe>';
        }
    } else if (videoSec) {
        videoSec.style.display = 'none';
    }

    // Reset tabs
    document.querySelectorAll('.pp-tab').forEach(function(t,i){ t.classList.toggle('on', i===0); });
    ['pp-about','pp-courses','pp-reviews','pp-docs'].forEach(function(id,i){
        document.getElementById(id).style.display = i===0 ? '' : 'none';
    });

    // Role-based button visibility
    var enrollBtn  = document.getElementById('pp-enroll-btn');
    var topEnroll  = document.querySelector('#page-profile .btn-sm.solid');
    var chatBtn    = document.getElementById('pp-chat-btn');
    var isTeacher  = currentUser && currentUser.role === 'teacher';
    var isOwnProfile = currentUser && currentUser.id === t.userId;
    if (enrollBtn)  enrollBtn.style.display  = (isTeacher || isOwnProfile) ? 'none' : '';
    if (topEnroll)  topEnroll.style.display  = (isTeacher || isOwnProfile) ? 'none' : '';
    if (chatBtn)    chatBtn.style.display     = isOwnProfile ? 'none' : '';
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
    ['pp-about','pp-courses','pp-reviews','pp-docs'].forEach(id => {
        var el = document.getElementById(id);
        if (el) el.style.display = id === tab ? '' : 'none';
    });
    if (tab === 'pp-reviews') showReviewForm();
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
    if (currentUser.role === 'teacher') { showToast('Преподаватели не могут записываться на курсы', 'info'); return; }
    pendingCourseId = courseId;
    go('student-dash'); loadStudentDash(); sdShow('payment-flow');
}

function goPayForProfileById(id) {
    currentProfileId = id;
    goPayForProfile();
}

function goPayForProfile() {
    if (!currentUser) { go('login'); return; }
    if (currentUser.role === 'teacher') { showToast('Преподаватели не могут записываться на курсы', 'info'); return; }
    get('/teachers/' + currentProfileId).then(t => {
        if (t.courses?.length) { pendingCourseId = t.courses[0].id; go('student-dash'); loadStudentDash(); sdShow('payment-flow'); }
        else showToast('У этого преподавателя пока нет курсов', 'info');
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
    if (code.length < 4) {
        document.getElementById('sms-err').style.display = 'block';
        document.getElementById('sms-err').textContent = 'Введите 4-значный код';
        return;
    }
    // Demo: accept any 4-digit code (real SMS integration requires backend)
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
        // Refresh balance for students immediately
        if (result.user.role === 'student') {
            get('/payments/balance').then(function(b) {
                currentUser.balance = b.balance;
                localStorage.setItem('user', JSON.stringify(currentUser));
                showLoggedIn();
            }).catch(function(){});
        }
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
    startStudentChatPoll();
    setAvatar(document.getElementById('sd-av'), currentUser);
    document.getElementById('sd-uname').textContent = currentUser.firstName + ' ' + currentUser.lastName;
    document.getElementById('sd-greet').textContent = currentUser.firstName + '!';
    setAvatar(document.getElementById('settings-av'), currentUser);
    document.getElementById('settings-name').textContent = currentUser.firstName + ' ' + currentUser.lastName;
    document.getElementById('sett-name').value = currentUser.firstName + ' ' + currentUser.lastName;
    document.getElementById('sett-email').value = currentUser.email || '';
    try {
        const [balData, enrollments, favs] = await Promise.all([get('/payments/balance'), get('/payments/enrollments'), get('/users/favorites').catch(()=>[])]);
        const favsEl = document.getElementById('dm-favs');
        if (favsEl) favsEl.textContent = Array.isArray(favs) ? favs.length : 0;
        currentUser.balance = balData.balance;
        localStorage.setItem('user', JSON.stringify(currentUser));
        showLoggedIn();
        const bal = balData.balance;
        const balNum = parseFloat(bal) || 0;
        document.getElementById('dh-balance').textContent = balNum.toLocaleString('ru');
        document.getElementById('dm-balance').textContent = balNum.toLocaleString('ru');
        document.getElementById('sb-bal-badge').textContent = balNum.toLocaleString('ru');
        document.getElementById('dh-courses').textContent = enrollments.length;
        document.getElementById('dm-courses').textContent = enrollments.length;
        document.getElementById('sb-courses-cnt').textContent = enrollments.length;
        if (enrollments.length > 0) {
            document.getElementById('sd-courses-preview').innerHTML = enrollments.slice(0,3).map(e =>
                `<div class="d-cr-row" onclick="openCourse('${e.course_id || e.id}')" style="cursor:pointer">
                  <div class="d-cr-ico">${e.emoji}</div>
                  <div class="d-cr-inf"><div class="d-cr-t">${e.title}</div><div class="d-cr-m">${e.first_name} ${e.last_name}</div></div>
                  <span class="st-badge2 st-on">Продолжить →</span>
                </div>`
            ).join('');
        }
    } catch(e) { console.error('loadStudentDash:', e); }
    try {
        const notifs = await get('/users/notifications');
        const unread = notifs.filter(n => !n.is_read).length;
        const badge  = document.getElementById('sb-notif-cnt');
        if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? '' : 'none'; }
        const dmEl = document.getElementById('dm-notifs');
        if (dmEl) dmEl.textContent = unread;
    } catch(e) {}
}

function sdShow(panel) {
    document.querySelectorAll('[id^="sdp-"]').forEach(p => p.classList.remove('on'));
    document.getElementById('sdp-' + panel)?.classList.add('on');
    // Update sidebar active state
    document.querySelectorAll('#page-student-dash .sidebar .sb-item').forEach(el => el.classList.remove('on'));
    if (panel === 'my-courses')   loadMyCourses();
    if (panel === 'favorites')    loadFavorites();
    if (panel === 'balance')      loadBalance();
    if (panel === 'payment-flow') initPayFlow();
    if (panel === 'notifications') loadNotifications();
    if (panel === 'settings')     loadSettingsPage();
    if (panel === 'chats')        loadStudentChats();
    setMobNav(panel, 'sd');
}

async function loadMyCourses() {
    try {
        const enrollments = await get('/payments/enrollments');
        const el = document.getElementById('sd-my-courses-list');
        if (!enrollments.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">Курсов пока нет</div><div class="empty-sub">Найдите преподавателя в каталоге</div><button class="btn-lg green" onclick="go(\'catalog\')">Найти</button></div>'; return; }
        el.innerHTML = '<div class="cg">' + enrollments.map(e =>
            `<div class="ccard" onclick="openCourse('${e.course_id || e.id}')">
              <div class="ccard-img">${e.emoji}</div>
              <div class="ccard-body">
                <div class="ccard-cat">${e.category}</div>
                <div class="ccard-title">${e.title}</div>
                <div class="ccard-teacher"><div class="t-dot" style="background:${e.color}">${e.initials}</div>${e.first_name} ${e.last_name}</div>
              </div>
              <div class="ccard-foot">
                <div class="ccard-price">${parseFloat(e.price).toLocaleString('ru')} смн</div>
                <button class="ccard-enroll" onclick="event.stopPropagation();openCourse('${e.course_id || e.id}')">Продолжить →</button>
              </div>
            </div>`
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
        const el = document.getElementById('notif-list');
        if (!notifs.length) {
            el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">Уведомлений нет</div>';
            return;
        }

        // Show unread ones first, then read
        const sorted = [...notifs].sort((a,b) => (a.is_read - b.is_read));

        el.innerHTML = sorted.map(n => {
            var ico = '🔔';
            if (n.type === 'new_message')  ico = '💬';
            if (n.type === 'homework')     ico = '📝';
            if (n.type === 'new_material') ico = '📎';
            if (n.type === 'topup')        ico = '💳';
            if (n.type === 'welcome')      ico = '🎉';
            var timeStr = new Date(n.created_at).toLocaleDateString('ru',{day:'numeric',month:'short'});
            return '<div class="notif-item' + (n.is_read ? '' : ' notif-unread') + '">' +
                '<div class="n-dot' + (n.is_read ? ' read' : '') + '"></div>' +
                '<div style="font-size:18px;flex-shrink:0">' + ico + '</div>' +
                '<div class="n-text"><strong>' + n.title + '</strong>' +
                (n.body ? '<br><span style="font-size:12px;color:var(--text2)">' + n.body + '</span>' : '') +
                '</div>' +
                '<div class="n-time">' + timeStr + '</div>' +
            '</div>';
        }).join('');

        // Mark as read AFTER showing
        await put('/users/notifications/read');

        // Reset badge
        const badge = document.getElementById('sb-notif-cnt');
        if (badge) { badge.textContent = '0'; badge.style.display = 'none'; }
        const dmNotifs = document.getElementById('dm-notifs');
        if (dmNotifs) dmNotifs.textContent = '0';

    } catch(e) { console.error(e); }
}


// ═══════════════════════════════════════════════════════
// SETTINGS PAGE LOADER
// ═══════════════════════════════════════════════════════
function loadSettingsPage() {
    if (!currentUser) return;
    const nameEl  = document.getElementById('sett-name');
    const emailEl = document.getElementById('sett-email');
    const avEl    = document.getElementById('settings-av');
    const nameDisp = document.getElementById('settings-name');
    if (nameEl)   nameEl.value  = (currentUser.firstName || '') + ' ' + (currentUser.lastName || '');
    if (emailEl)  emailEl.value = currentUser.email || '';
    if (avEl)     setAvatar(avEl, currentUser);
    if (nameDisp) nameDisp.textContent = (currentUser.firstName || '') + ' ' + (currentUser.lastName || '');
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
        showToast('Профиль сохранён');
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
        showToast('Пароль изменён');
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
// Background chat polling for teacher
var teacherPollInterval = null;
function startTeacherChatPoll() {
    if (teacherPollInterval) clearInterval(teacherPollInterval);
    var _lastTeacherChatUnread = -1;
    teacherPollInterval = setInterval(async function() {
        if (!currentUser || currentUser.role !== 'teacher') { clearInterval(teacherPollInterval); return; }
        try {
            var chats = await get('/users/chats');
            var unread = chats.reduce(function(sum, c) { return sum + (parseInt(c.unread)||0); }, 0);
            var badge = document.getElementById('td-chat-cnt');
            if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? '' : 'none'; }
            // Перерисовываем список только если изменилось количество непрочитанных
            if (unread !== _lastTeacherChatUnread) {
                _lastTeacherChatUnread = unread;
                var chatPanel = document.getElementById('tdp-t-chats');
                if (chatPanel && chatPanel.classList.contains('on')) loadTeacherChats();
            }
        } catch(e) {}
    }, 10000);
}

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
        const [stats, courses, myProfile] = await Promise.all([
            get('/teachers/my/stats'),
            get('/courses/my/list'),
            get('/teachers/' + currentUser.id).catch(() => null)
        ]);
        document.getElementById('tdm-students').textContent = stats.totalStudents;
        document.getElementById('tdm-courses').textContent = stats.totalCourses;
        document.getElementById('tdm-earn').textContent = parseFloat(stats.netRevenue).toLocaleString('ru') + ' смн';
        const ratingEl = document.getElementById('tdm-rating');
        if (ratingEl) ratingEl.textContent = myProfile && myProfile.rating > 0 ? parseFloat(myProfile.rating).toFixed(1) + ' ★' : '—';
        document.getElementById('td-courses-cnt').textContent = courses.length;
        document.getElementById('earn-gross').textContent = parseFloat(stats.grossRevenue).toLocaleString('ru') + ' смн';
        document.getElementById('earn-comm').textContent = parseFloat(stats.commission).toLocaleString('ru') + ' смн';
        document.getElementById('earn-net').textContent = parseFloat(stats.netRevenue).toLocaleString('ru') + ' смн';
        const previewEl = document.getElementById('td-courses-preview');
        if (previewEl) {
            if (courses.length > 0) {
                previewEl.innerHTML = courses.slice(0,3).map(c =>
                    `<div class="d-cr-row">
                      <div class="d-cr-ico">${c.emoji}</div>
                      <div class="d-cr-inf">
                        <div class="d-cr-t">${c.title}</div>
                        <div class="d-cr-m">${c.category} · ${c.student_count||0} уч. · <span class="st-badge2 ${c.status==='active'?'st-on':'st-rev'}">${c.status==='active'?'Активен':'На проверке'}</span></div>
                      </div>
                      <div class="d-cr-price">${parseFloat(c.price).toLocaleString('ru')} смн</div>
                    </div>`
                ).join('');
            } else {
                previewEl.innerHTML = '<div class="empty-state" style="padding:1.5rem"><div class="empty-icon">📚</div><div class="empty-title">Курсов пока нет</div><button class="btn-sm solid" onclick="tdShow(\'t-add-course\')">Добавить курс</button></div>';
            }
        }
        // Load notification badge for teacher
        try {
            const tNotifs = await get('/users/notifications');
            const tUnread = tNotifs.filter(n => !n.is_read).length;
            const tBadge = document.getElementById('td-notifs-cnt');
            if (tBadge) { tBadge.textContent = tUnread; tBadge.style.display = tUnread > 0 ? '' : 'none'; }
        } catch(e) {}

        // Load chats badge for teacher
        try {
            const chats = await get('/users/chats');
            const unreadChats = chats.filter(c => c.unread > 0).length;
            const chatBadge = document.getElementById('td-chat-cnt');
            if (chatBadge) { chatBadge.textContent = unreadChats; chatBadge.style.display = unreadChats > 0 ? '' : 'none'; }
        } catch(e) {}
    } catch(e) { console.error('loadTeacherDash:', e); }
    document.getElementById('tp-fname').value = currentUser.firstName || '';
    document.getElementById('tp-lname').value = currentUser.lastName || '';
    document.getElementById('tp-email').value = currentUser.email || '';
    // Show existing video in preview if available
    var preview = document.getElementById('tp-video-preview');
    var player = document.getElementById('tp-video-player');
    var fname = document.getElementById('tp-video-fname');
    var videoInput = document.getElementById('tp-video-input');
    if (preview) preview.style.display = 'none';
    if (player) player.src = '';
    if (fname) fname.textContent = 'Выбрать видео (MP4, до 100 МБ)';
    if (videoInput) videoInput.value = '';
    if (currentUser.videoUrl && preview && player) {
        player.src = currentUser.videoUrl;
        preview.style.display = 'block';
        if (fname) fname.textContent = 'Видео загружено ✓';
    }
    // Start background chat polling
    startTeacherChatPoll();

    // Load conditions checkboxes
    var cond = currentUser.conditions || {};
    if (document.getElementById('tp-trial'))    document.getElementById('tp-trial').checked    = !!cond.trial;
    if (document.getElementById('tp-homework')) document.getElementById('tp-homework').checked = !!cond.homework;
}

function tdShow(panel) {
    document.querySelectorAll('[id^="tdp-"]').forEach(p => p.classList.remove('on'));
    document.getElementById('tdp-' + panel)?.classList.add('on');
    // Update sidebar active state
    document.querySelectorAll('#page-teacher-dash .sidebar .sb-item').forEach(el => el.classList.remove('on'));
    if (panel === 't-courses')  loadTeacherCourses();
    if (panel === 't-students') loadTeacherStudents();
    if (panel === 't-chats')    loadTeacherChats();
    if (panel === 't-profile')  loadTeacherDocs();
    if (panel === 't-notifs')   loadTeacherNotifications();
    setMobNav(panel, 'td');
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
        el.innerHTML = '<div class="d-card" style="padding:1.2rem">' + students.map(s => {
            var pct = s.progress || 0;
            var av  = s.avatar_url
                ? '<img src="' + s.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">'
                : (s.initials || '?');
            return '<div class="d-st-row" onclick="openStudentPage(\'' + s.id + '\', \'' + s.course_id + '\')" style="cursor:pointer;transition:background .15s;border-radius:9px;padding:10px 8px" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">'+
                '<div class="d-st-av" style="background:' + (s.color||'#18A96A') + ';overflow:hidden">' + av + '</div>'+
                '<div style="flex:1">'+
                    '<div style="font-size:13px;font-weight:700">' + s.first_name + ' ' + s.last_name + '</div>'+
                    '<div style="font-size:11px;color:var(--text2)">' + (s.emoji||'📖') + ' ' + s.course_title + ' · ' + new Date(s.enrolled_at).toLocaleDateString('ru',{day:'numeric',month:'short'}) + '</div>'+
                    '<div style="height:4px;background:var(--border2);border-radius:2px;margin-top:5px;width:100px"><div style="height:100%;width:' + pct + '%;background:var(--g);border-radius:2px;transition:width .4s"></div></div>'+
                '</div>'+
                '<div style="text-align:right">'+
                    '<div style="font-size:13px;font-weight:700;color:var(--g2)">' + parseFloat(s.teacher_amount||0).toLocaleString('ru') + ' смн</div>'+
                    '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + pct + '% курса</div>'+
                '</div>'+
            '</div>';
        }).join('') + '</div>';
    } catch(e) { console.error(e); }
}

async function saveTeacherProfile() {
    try {
        // Upload video first if selected
        var videoInput = document.getElementById('tp-video-input');
        var saveBtn = document.querySelector('button.btn-save[onclick="saveTeacherProfile()"]');
        if (videoInput && videoInput.files && videoInput.files[0]) {
            if (saveBtn) { saveBtn.textContent = '⏳ Загрузка видео...'; saveBtn.disabled = true; }
            var fd = new FormData();
            fd.append('video', videoInput.files[0]);
            var vResult = await upload('/teachers/profile/video', fd);
            currentUser.videoUrl = vResult.videoUrl;
            if (saveBtn) { saveBtn.textContent = '⏳ Сохранение...'; }
        }

        await put('/teachers/profile/update', {
            firstName: document.getElementById('tp-fname').value,
            lastName: document.getElementById('tp-lname').value,
            subject: document.getElementById('tp-subject').value,
            bio: document.getElementById('tp-bio').value,
            price: parseFloat(document.getElementById('tp-price').value) || 0,
            conditions: {
                trial:    document.getElementById('tp-trial')    ? document.getElementById('tp-trial').checked    : false,
                homework: document.getElementById('tp-homework') ? document.getElementById('tp-homework').checked : false,
            }
        });
        // video handled above
        const fresh = await get('/auth/me');
        currentUser = { ...currentUser, ...fresh };
        localStorage.setItem('user', JSON.stringify(currentUser));
        showLoggedIn();
        var saveBtn = document.querySelector('button.btn-save');
        if (saveBtn) { saveBtn.textContent = 'Сохранить изменения'; saveBtn.disabled = false; }
        showToast('Профиль сохранён');
    } catch(e) { alert('Ошибка: ' + e.message); }
}



// ═══════════════════════════════════════════════════════
// STUDENT CHATS
// ═══════════════════════════════════════════════════════
async function loadStudentChats() {
    const el = document.getElementById('sd-chats-list');
    if (!el) return;
    // Показываем загрузку только если список пустой (первый раз)
    if (!el.querySelector('.chat-list-item')) {
        el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">⏳ Загрузка...</div>';
    }
    try {
        const chats = await get('/users/chats');

        // Clear chat badge
        const badge = document.getElementById('sb-chat-cnt');
        if (badge) { badge.textContent = '0'; badge.style.display = 'none'; }

        if (!chats.length) {
            el.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div>' +
                '<div class="empty-title">Нет переписок</div>' +
                '<div class="empty-sub">Напишите преподавателю через его профиль</div>' +
                '<button class="btn-lg green" onclick="go(\'catalog\')">Найти преподавателя</button></div>';
            return;
        }

        el.innerHTML = chats.map(function(c) {
            var initials   = (c.first_name?.[0] || '') + (c.last_name?.[0] || '');
            var lastMsg    = c.last_msg || c.last_message || '';
            var shortMsg   = lastMsg ? lastMsg.substring(0, 50) + (lastMsg.length > 50 ? '…' : '') : 'Нет сообщений';
            var unreadNum  = parseInt(c.unread) || 0;
            var timeStr    = c.last_time ? new Date(c.last_time).toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'}) : '';
            var safeName   = (c.first_name + ' ' + c.last_name).replace(/'/g, "\'");
            var safeColor  = c.color || '#18A96A';

            return '<div class="chat-list-item" onclick="openChatWithStudent(\'' + c.id + '\', \'' + safeName + '\', \'' + initials + '\', \'' + safeColor + '\')">' +
                '<div class="cli-av" style="background:' + safeColor + '">' +
                    (c.avatar_url
                        ? '<img src="' + c.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">'
                        : (initials || '?')) +
                '</div>' +
                '<div class="cli-info">' +
                    '<div class="cli-name">' + c.first_name + ' ' + c.last_name + '</div>' +
                    '<div class="cli-last">' + shortMsg + '</div>' +
                '</div>' +
                '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">' +
                    (timeStr ? '<div style="font-size:11px;color:var(--text3);font-weight:600">' + timeStr + '</div>' : '') +
                    (unreadNum > 0 ? '<span class="cli-badge">' + unreadNum + '</span>' : '') +
                '</div>' +
                '</div>';
        }).join('');

    } catch(e) {
        console.error('loadStudentChats:', e);
        el.innerHTML = '<div style="text-align:center;padding:2rem;color:#EF4444">Ошибка загрузки. Попробуйте снова.</div>';
    }
}

// Student chat polling — check for new messages every 10s
var studentChatPollInterval = null;
function startStudentChatPoll() {
    if (studentChatPollInterval) clearInterval(studentChatPollInterval);
    var _lastStudentChatUnread = -1;
    studentChatPollInterval = setInterval(async function() {
        if (!currentUser || currentUser.role !== 'student') { clearInterval(studentChatPollInterval); return; }
        try {
            var chats = await get('/users/chats');
            var unread = chats.reduce(function(sum, c) { return sum + (parseInt(c.unread)||0); }, 0);
            var badge = document.getElementById('sb-chat-cnt');
            if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? '' : 'none'; }
            // Перерисовываем список только если изменилось количество непрочитанных
            if (unread !== _lastStudentChatUnread) {
                _lastStudentChatUnread = unread;
                var panel = document.getElementById('sdp-chats');
                if (panel && panel.classList.contains('on')) loadStudentChats();
            }
        } catch(e) {}
    }, 10000);
}

// ═══════════════════════════════════════════════════════
// TEACHER CHATS
// ═══════════════════════════════════════════════════════
async function loadTeacherChats() {
    const el = document.getElementById('td-chats-list');
    if (!el) return;
    // Показываем загрузку только если список пустой (первый раз)
    if (!el.querySelector('.chat-list-item')) {
        el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">⏳ Загрузка...</div>';
    }
    try {
        const chats = await get('/users/chats');
        if (!chats.length) {
            el.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Нет сообщений</div><div class="empty-sub">Ученики ещё не написали вам</div></div>';
            return;
        }
        el.innerHTML = chats.map(c => {
            const initials = (c.first_name?.[0] || '') + (c.last_name?.[0] || '');
            var lastMsg = c.last_msg || c.last_message || '';
            var shortMsg = lastMsg ? lastMsg.substring(0,45) + (lastMsg.length > 45 ? '…' : '') : 'Нет сообщений';
            var unreadNum = parseInt(c.unread) || 0;
            return '<div class="chat-list-item" onclick="openChatWithStudent(\'' + c.id + '\', \'' + (c.first_name + ' ' + c.last_name).replace(/'/g,"\\'" ) + '\', \'' + initials + '\', \'' + (c.color||'#18A96A') + '\')">' +
                '<div class="cli-av" style="background:' + (c.color||'#18A96A') + '">' + (initials || '?') + '</div>' +
                '<div class="cli-info">' +
                '<div class="cli-name">' + c.first_name + ' ' + c.last_name + '</div>' +
                '<div class="cli-last">' + shortMsg + '</div>' +
                '</div>' +
                (unreadNum > 0 ? '<span class="cli-badge">' + unreadNum + '</span>' : '') +
                '</div>';
        }).join('');
    } catch(e) { console.error('loadTeacherChats:', e); }
}

function openChatWithStudent(studentId, name, initials, color) {
    chatTeacherId = studentId;
    var nameEl = document.getElementById('chat-name');
    var avEl   = document.getElementById('chat-av');
    if (nameEl) nameEl.textContent = name;
    if (avEl)   { avEl.textContent = initials; avEl.style.background = color; }
    var modal = document.getElementById('chat-modal');
    if (modal) modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(function() { document.getElementById('chat-input')?.focus(); }, 150);
    loadMessages();
    if (chatInterval) clearInterval(chatInterval);
    chatInterval = setInterval(loadMessages, 4000);
}


// ═══════════════════════════════════════════════════════
// TEACHER NOTIFICATIONS
// ═══════════════════════════════════════════════════════
async function loadTeacherNotifications() {
    const el = document.getElementById('td-notif-list');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text3)">⏳ Загрузка...</div>';
    try {
        const notifs = await get('/users/notifications');

        if (!notifs.length) {
            el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">Уведомлений нет</div>';
            return;
        }

        const sorted = [...notifs].sort((a, b) => a.is_read - b.is_read);
        const ICONS  = { new_message:'💬', homework:'📝', new_material:'📎',
                         topup:'💳', welcome:'🎉', new_teacher:'👤', new_course:'📚' };

        el.innerHTML = sorted.map(function(n) {
            var ico     = ICONS[n.type] || '🔔';
            var time    = new Date(n.created_at).toLocaleDateString('ru', {day:'numeric', month:'short'});
            var unread  = !n.is_read;
            return '<div class="notif-item' + (unread ? ' notif-unread' : '') + '">' +
                '<div class="n-dot' + (unread ? '' : ' read') + '"></div>' +
                '<div style="font-size:18px;flex-shrink:0">' + ico + '</div>' +
                '<div class="n-text">' +
                    '<strong>' + n.title + '</strong>' +
                    (n.body ? '<br><span style="font-size:12px;color:var(--text2)">' + n.body + '</span>' : '') +
                '</div>' +
                '<div class="n-time">' + time + '</div>' +
            '</div>';
        }).join('');

        // Mark as read
        await put('/users/notifications/read');

        // Reset badge
        const badge = document.getElementById('td-notifs-cnt');
        if (badge) { badge.style.display = 'none'; }

    } catch(e) { console.error('loadTeacherNotifications:', e); }
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


function previewVideo(input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    document.getElementById('tp-video-fname').textContent = file.name;
    document.getElementById('tp-video-btn').style.display = 'block';
    var url = URL.createObjectURL(file);
    var preview = document.getElementById('tp-video-preview');
    var player = document.getElementById('tp-video-player');
    if (preview && player) {
        player.src = url;
        preview.style.display = 'block';
    }
}

async function uploadTeacherVideo() {
    var input = document.getElementById('tp-video-input');
    if (!input || !input.files || !input.files[0]) return alert('Выберите видео файл');
    var file = input.files[0];
    if (file.size > 100 * 1024 * 1024) return alert('Файл слишком большой. Максимум 100 МБ');
    var btn = document.getElementById('tp-video-btn');
    btn.textContent = 'Загрузка...';
    btn.disabled = true;
    try {
        var fd = new FormData();
        fd.append('video', file);
        var result = await upload('/teachers/profile/video', fd);
        currentUser.videoUrl = result.videoUrl;
        localStorage.setItem('user', JSON.stringify(currentUser));
        btn.textContent = '✅ Загружено!';
        setTimeout(function() { btn.textContent = 'Загрузить'; btn.disabled = false; }, 2000);
    } catch(e) {
        alert('Ошибка загрузки: ' + e.message);
        btn.textContent = 'Загрузить';
        btn.disabled = false;
    }
}


async function loadTeacherDocs() {
    var el = document.getElementById('td-docs-list');
    if (!el) return;
    try {
        var t = await get('/teachers/' + currentUser.id);
        var docs = t.documents || [];
        if (!docs.length) {
            el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:12px;background:var(--bg);border-radius:9px">Документы не загружены</div>';
            return;
        }
        el.innerHTML = docs.map(function(d) {
            var ico = d.type==='diploma'?'🎓':d.type==='certificate'?'📜':'📋';
            var typeName = d.type==='diploma'?'Диплом':d.type==='certificate'?'Сертификат':'Трудовая';
            var status = d.isVerified
                ? '<span style="color:var(--g2);font-weight:700;font-size:12px">✓ Проверен</span>'
                : '<span style="color:var(--yellow);font-weight:700;font-size:12px">⏳ На проверке</span>';
            return '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg);border-radius:9px;margin-bottom:8px">' +
                '<div style="font-size:22px">' + ico + '</div>' +
                '<div style="flex:1"><div style="font-size:12px;color:var(--text3);font-weight:700">' + typeName + '</div>' +
                '<div style="font-size:13px;font-weight:700">' + d.name + '</div></div>' +
                status + '</div>';
        }).join('');
    } catch(e) { console.log(e); }
}

async function addTeacherDoc() {
    var type = document.getElementById('new-doc-type').value;
    var name = document.getElementById('new-doc-name').value.trim();
    var inst = document.getElementById('new-doc-inst').value.trim();
    var year = document.getElementById('new-doc-year').value.trim();
    var fileInput = document.getElementById('new-doc-file');

    if (!name) return alert('Введите название документа');
    if (!fileInput.files || !fileInput.files[0]) return alert('Выберите файл');

    var btn = event.target;
    btn.textContent = 'Загрузка...';
    btn.disabled = true;

    try {
        var fd = new FormData();
        fd.append('document', fileInput.files[0]);
        fd.append('docType', type);
        fd.append('docName', name);
        fd.append('institution', inst);
        fd.append('year', year);
        await upload('/teachers/profile/documents', fd);
        
        // Reset form
        document.getElementById('new-doc-name').value = '';
        document.getElementById('new-doc-inst').value = '';
        document.getElementById('new-doc-year').value = '';
        fileInput.value = '';
        document.getElementById('new-doc-fname').textContent = 'Выбрать файл';
        
        loadTeacherDocs();
        showToast('Документ загружен на проверку');
    } catch(e) {
        alert('Ошибка: ' + e.message);
    }
    btn.textContent = '+ Добавить документ';
    btn.disabled = false;
}


var selectedStars = 0;

function setStars(n) {
    selectedStars = n;
    document.querySelectorAll('.star-btn').forEach(function(s) {
        s.style.opacity = parseInt(s.getAttribute('data-v')) <= n ? '1' : '0.3';
        s.style.color = parseInt(s.getAttribute('data-v')) <= n ? '#F59E0B' : '';
    });
}

async function submitReview() {
    if (!selectedStars) return alert('Поставьте оценку от 1 до 5 звёзд');
    var text = document.getElementById('pp-rev-text').value.trim();
    if (!text) return alert('Напишите отзыв');
    if (!currentProfileId) return;

    // Need a course_id - get first enrolled course of this teacher
    try {
        var enrollments = await get('/payments/enrollments');
        var teacherEnroll = enrollments.find(function(e) { return e.teacherId === currentProfileId || e.teacher_id === currentProfileId; });
        if (!teacherEnroll) return showToast('Запишитесь на курс чтобы оставить отзыв', 'info');

        var btn = event.target;
        btn.textContent = 'Отправка...';
        btn.disabled = true;

        await post('/users/reviews', {
            teacherId: currentProfileId,
            courseId: teacherEnroll.courseId || teacherEnroll.course_id,
            stars: selectedStars,
            text: text
        });

        // Reset form
        selectedStars = 0;
        setStars(0);
        document.getElementById('pp-rev-text').value = '';
        document.getElementById('pp-rev-form').style.display = 'none';
        btn.textContent = 'Отправить отзыв';
        btn.disabled = false;

        showToast('Отзыв отправлен! Спасибо');
        openProfile(currentProfileId); // Reload profile
    } catch(e) {
        alert('Ошибка: ' + e.message);
        event.target.textContent = 'Отправить отзыв';
        event.target.disabled = false;
    }
}

function showReviewForm() {
    if (!currentUser) {
        document.getElementById('pp-rev-login-hint').style.display = 'block';
        document.getElementById('pp-rev-form').style.display = 'none';
        return;
    }
    if (currentUser.role === 'student') {
        document.getElementById('pp-rev-form').style.display = 'block';
        document.getElementById('pp-rev-login-hint').style.display = 'none';
    }
}


var chatTeacherId = null;
var chatInterval = null;
var chatLastId = 0;

function openChat() {
    if (!currentUser) { go('login'); return; }
    if (!currentProfileId) return;
    if (currentUser.role === 'teacher' && currentProfileId === currentUser.id) {
        alert('Вы не можете написать самому себе');
        return;
    }
    chatTeacherId = currentProfileId;

    // Set teacher info in chat header
    var nameEl = document.getElementById('chat-name');
    var avEl   = document.getElementById('chat-av');
    var hnameEl = document.getElementById('pp-hname');
    if (nameEl) nameEl.textContent = hnameEl ? hnameEl.textContent : 'Преподаватель';
    if (avEl) {
        var ppAv = document.getElementById('pp-av');
        if (ppAv) avEl.innerHTML = ppAv.innerHTML || ppAv.textContent;
    }

    var modal = document.getElementById('chat-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Focus input
    setTimeout(function() { document.getElementById('chat-input')?.focus(); }, 150);
    loadMessages();
    if (chatInterval) clearInterval(chatInterval);
    chatInterval = setInterval(loadMessages, 4000);
}

function closeChat() {
    var modal = document.getElementById('chat-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    if (chatInterval) { clearInterval(chatInterval); chatInterval = null; }
}

async function loadMessages() {
    if (!chatTeacherId || !currentUser) return;
    try {
        var msgs = await get('/users/chat/' + chatTeacherId);
        var el = document.getElementById('chat-messages');
        if (!msgs.length) {
            el.innerHTML = '<div class="chat-empty"><div class="chat-empty-ico">💬</div>Начните общение с преподавателем</div>';
            return;
        }
        var html = msgs.map(function(m) {
            var isMe = m.sender_id === currentUser.id;
            var time = new Date(m.created_at).toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'});
            // Escape HTML to prevent XSS
            var safeText = m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            return '<div class="chat-msg ' + (isMe ? 'me' : 'them') + '">' +
                '<div class="chat-bubble">' + safeText + '</div>' +
                '<div class="chat-time">' + time + '</div>' +
                '</div>';
        }).join('');
        el.innerHTML = html;
        el.scrollTop = el.scrollHeight;
    } catch(e) { console.error('loadMessages:', e); }
}

async function sendMsg(e) {
    if (e && e.key && e.key !== 'Enter') return;
    if (e && e.key === 'Enter' && e.shiftKey) return; // allow shift+enter for newline
    var input = document.getElementById('chat-input');
    var text = input.value.trim();
    if (!text || !chatTeacherId) return;
    var sendBtn = document.querySelector('.chat-send-btn');
    input.value = '';
    input.style.height = 'auto';
    if (sendBtn) sendBtn.style.opacity = '0.5';
    try {
        await post('/users/chat/' + chatTeacherId, { text: text });
        await loadMessages();
    } catch(ex) {
        input.value = text;
        showToast('Ошибка отправки: ' + ex.message, 'error');
    } finally {
        if (sendBtn) sendBtn.style.opacity = '1';
    }
}



// ═══════════════════════════════════════════════════════
// TOAST NOTIFICATIONS (replaces alert())
// ═══════════════════════════════════════════════════════
function showToast(msg, type) {
    type = type || 'success'; // 'success' | 'error' | 'info'
    var existing = document.getElementById('edu-toast');
    if (existing) existing.remove();
    var t = document.createElement('div');
    t.id = 'edu-toast';
    var colors = { success: '#18A96A', error: '#DC2626', info: '#2563EB' };
    var icons  = { success: '✅', error: '❌', info: 'ℹ️' };
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#0C1810;color:#fff;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;z-index:9999;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.3);opacity:0;transition:all .3s ease;white-space:nowrap;max-width:90vw;border-left:3px solid ' + colors[type];
    t.innerHTML = '<span>' + icons[type] + '</span><span>' + msg + '</span>';
    document.body.appendChild(t);
    requestAnimationFrame(function() {
        t.style.opacity = '1';
        t.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(function() {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(function() { t.remove(); }, 300);
    }, 3200);
}



// ═══════════════════════════════════════════════════════
// СТРАНИЦА УЧЕНИКА ДЛЯ УЧИТЕЛЯ
// ═══════════════════════════════════════════════════════
let currentStudentId   = null;
let currentStudentData = null;
let currentTsHwId      = null;
let slotCount          = 1;

async function openStudentPage(studentId, courseId) {
    currentStudentId = studentId;
    currentCourseId  = courseId;
    go('teacher-student');
    await loadStudentPageData();
    // Start polling for new messages from this student
    startCourseChatPoll(studentId, 'ts-chat-notify-btn');
}

function openChatWithStudentFromPage() {
    if (!currentStudentData) return;
    const s = currentStudentData.student;
    // Clear badge
    var btn = document.getElementById('ts-chat-notify-btn');
    if (btn) {
        var b = btn.querySelector('.chat-page-badge');
        if (b) b.remove();
        btn.style.borderColor = '';
        btn.style.color = '';
    }
    openChatWithStudent(s.id, s.firstName + ' ' + s.lastName, s.initials, s.color || '#18A96A');
}

async function loadStudentPageData() {
    try {
        const data = await get('/teachers/student/' + currentStudentId + '/course/' + currentCourseId);
        currentStudentData = data;
        renderStudentPage(data);
    } catch(e) {
        showToast('Ошибка загрузки: ' + (e.message || ''), 'error');
    }
}


// ── Materials ──
function previewMatFile(input) {
    if (!input.files || !input.files[0]) return;
    var name = input.files[0].name;
    var size = input.files[0].size;
    var sizeStr = size > 1024*1024 ? (size/1024/1024).toFixed(1)+' МБ' : (size/1024).toFixed(0)+' КБ';
    document.getElementById('ts-mat-fname').textContent = name + ' (' + sizeStr + ')';
}

async function uploadMaterial() {
    var title    = document.getElementById('ts-mat-title').value.trim();
    var desc     = document.getElementById('ts-mat-desc').value.trim();
    var lessonId = document.getElementById('ts-mat-lesson').value;
    var fileInput = document.getElementById('ts-mat-file');

    if (!title)              { showToast('Введите название материала', 'info'); return; }
    if (!fileInput.files[0]) { showToast('Выберите файл', 'info'); return; }

    var file = fileInput.files[0];
    if (file.size > 50 * 1024 * 1024) { showToast('Файл слишком большой. Максимум 50 МБ', 'error'); return; }

    var btn = document.getElementById('ts-mat-btn');
    btn.textContent = '⏳ Загрузка...';
    btn.disabled    = true;

    try {
        var fd = new FormData();
        fd.append('file',      file);
        fd.append('courseId',  currentCourseId);
        fd.append('title',     title);
        fd.append('description', desc);
        if (lessonId) fd.append('lessonId', lessonId);

        var token = localStorage.getItem('token');
        var res   = await fetch(API + '/teachers/materials/upload', {
            method: 'POST',
            headers: token ? { 'Authorization': 'Bearer ' + token } : {},
            body: fd,
        });
        var json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Ошибка загрузки');

        // Reset form
        document.getElementById('ts-mat-title').value = '';
        document.getElementById('ts-mat-desc').value  = '';
        document.getElementById('ts-mat-file').value  = '';
        document.getElementById('ts-mat-fname').textContent = 'Выберите файл для загрузки';

        showToast('✅ Материал загружен и отправлен ученикам!');
        await loadStudentPageData();
    } catch(e) {
        showToast('Ошибка: ' + (e.message || ''), 'error');
    } finally {
        btn.textContent = '⬆️ Загрузить материал';
        btn.disabled    = false;
    }
}

function renderTsMaterials(materials) {
    var el = document.getElementById('ts-mat-list');
    if (!el) return;

    if (!materials || !materials.length) {
        el.innerHTML = '<div class="cp-empty"><div class="cp-empty-ico">📎</div>' +
            '<div class="cp-empty-title">Материалов пока нет</div>' +
            '<div class="cp-empty-sub">Загрузите файлы выше — ученик сразу получит уведомление</div></div>';
        return;
    }

    var TYPE_ICONS = {
        pdf:'📄', doc:'📝', docx:'📝', ppt:'📊', pptx:'📊',
        xls:'📈', xlsx:'📈', jpg:'🖼️', jpeg:'🖼️', png:'🖼️',
        mp4:'🎬', mp3:'🎵', zip:'🗜️', rar:'🗜️', txt:'📋'
    };

    el.innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:10px">' +
        'Загруженные материалы (' + materials.length + '):</div>' +
        materials.map(function(m) {
            var ext  = m.fileUrl ? m.fileUrl.split('.').pop().toLowerCase().split('?')[0] : '';
            var ico  = TYPE_ICONS[ext] || '📎';
            var size = m.fileSize ? (m.fileSize > 1024*1024
                ? (m.fileSize/1024/1024).toFixed(1)+' МБ'
                : (m.fileSize/1024).toFixed(0)+' КБ') : '';
            var date = m.createdAt
                ? new Date(m.createdAt).toLocaleDateString('ru',{day:'numeric',month:'short'})
                : '';
            return '<div class="cp-mat-card" style="display:flex;align-items:center;gap:14px">' +
                '<div class="cp-mat-ico">' + ico + '</div>' +
                '<div class="cp-mat-info" style="flex:1">' +
                    '<div class="cp-mat-title">' + m.title + '</div>' +
                    '<div class="cp-mat-meta">' +
                        (m.lessonTitle ? m.lessonTitle + ' · ' : '') +
                        (size ? size + ' · ' : '') + date +
                    '</div>' +
                '</div>' +
                (m.fileUrl
                    ? '<a href="' + m.fileUrl + '" target="_blank" class="btn-sm ghost" style="white-space:nowrap">⬇️ Открыть</a>'
                    : '') +
                '<button onclick="deleteMaterial(\'' + m.id + '\')" style="background:none;border:none;color:var(--text3);font-size:18px;cursor:pointer;padding:4px;transition:color .2s" onmouseover="this.style.color=\'#EF4444\'" onmouseout="this.style.color=\'var(--text3)\'">🗑</button>' +
            '</div>';
        }).join('');
}

async function deleteMaterial(matId) {
    if (!confirm('Удалить этот материал?')) return;
    try {
        var token = localStorage.getItem('token');
        var res   = await fetch(API + '/teachers/materials/' + matId, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Ошибка удаления');
        showToast('Материал удалён');
        await loadStudentPageData();
    } catch(e) { showToast('Ошибка: ' + e.message, 'error'); }
}

function renderStudentPage(data) {
    const { student, course, enrollment, lessons, progress, homework, schedule } = data;

    // Breadcrumb & hero
    document.getElementById('ts-bc-name').textContent     = student.firstName + ' ' + student.lastName;
    document.getElementById('ts-student-name').textContent = student.firstName + ' ' + student.lastName;
    document.getElementById('ts-course-cat').textContent  = course.category;
    document.getElementById('ts-course-title').textContent = course.title;
    document.getElementById('ts-course-emoji').textContent = course.emoji;
    document.getElementById('ts-enrolled-at').textContent  =
        'Записан ' + new Date(enrollment.enrolledAt).toLocaleDateString('ru',{day:'numeric',month:'short',year:'numeric'});

    // Avatar
    const avEl = document.getElementById('ts-av');
    if (student.avatarUrl) {
        avEl.innerHTML = '<img src="' + student.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:16px">';
        avEl.style.background = student.color || '#18A96A';
    } else {
        avEl.textContent   = student.initials || '?';
        avEl.style.background = student.color || '#18A96A';
        avEl.style.color   = '#fff';
        avEl.style.display = 'flex';
        avEl.style.alignItems = 'center';
        avEl.style.justifyContent = 'center';
        avEl.style.fontWeight = '800';
    }

    // Progress ring
    const pct = progress.percent || 0;
    const offset = 201 - (201 * pct / 100);
    const ringEl = document.getElementById('ts-ring-fill');
    if (ringEl) setTimeout(() => { ringEl.style.strokeDashoffset = offset; }, 100);
    document.getElementById('ts-pct').textContent = pct + '%';
    document.getElementById('ts-pb-fill').style.width = pct + '%';
    document.getElementById('ts-pb-text').textContent = progress.done + ' из ' + progress.total + ' уроков';

    // Render lessons (read-only view)
    const lessonsEl = document.getElementById('ts-lessons-list');
    if (lessons.length) {
        lessonsEl.innerHTML = lessons.map(function(l) {
            return '<div class="cp-lesson' + (l.isDone ? ' done' : '') + '">' +
                '<div class="cp-lesson-num">' + (l.isDone ? '✓' : l.order) + '</div>' +
                '<div class="cp-lesson-info">' +
                    '<div class="cp-lesson-title">' + l.title + '</div>' +
                    '<div class="cp-lesson-meta">' + (l.isDone && l.doneAt
                        ? '✅ Пройдено ' + new Date(l.doneAt).toLocaleDateString('ru',{day:'numeric',month:'short'})
                        : '⏳ Не пройдено') + '</div>' +
                '</div>' +
                '<div style="font-size:20px">' + (l.isDone ? '✅' : '⬜') + '</div>' +
            '</div>';
        }).join('');
    } else {
        lessonsEl.innerHTML = '<div class="cp-empty"><div class="cp-empty-ico">📚</div><div class="cp-empty-title">Уроков нет</div></div>';
    }

    // Populate lesson select in HW form
    const sel = document.getElementById('ts-hw-lesson');
    sel.innerHTML = '<option value="">— Общее задание —</option>' +
        lessons.map(function(l) { return '<option value="' + l.id + '">Урок ' + l.order + ': ' + l.title + '</option>'; }).join('');

    // Render existing schedule
    renderTsSchedule(schedule);

    // Render homework
    renderTsHomework(homework);

    // Populate lesson selects for homework AND materials
    const selMat = document.getElementById('ts-mat-lesson');
    if (selMat) {
        selMat.innerHTML = '<option value="">— Общий материал —</option>' +
            lessons.map(function(l) {
                return '<option value="' + l.id + '">Урок ' + l.order + ': ' + l.title + '</option>';
            }).join('');
    }

    // Render materials
    renderTsMaterials(data.materials || []);

    // Reset to first tab
    tsTab('progress', document.querySelector('.cp-tab.on') || document.querySelector('.cp-tab'));
}

function tsTab(tab, btn) {
    document.querySelectorAll('#page-teacher-student .cp-tab').forEach(function(t){ t.classList.remove('on'); });
    if (btn) btn.classList.add('on');
    document.querySelectorAll('#page-teacher-student .cp-section').forEach(function(s){ s.classList.remove('on'); });
    var sec = document.getElementById('tss-' + tab);
    if (sec) sec.classList.add('on');
}

// ── Schedule ──
function addSchedSlot() {
    const container = document.getElementById('ts-sched-slots');
    const div = document.createElement('div');
    div.className = 'ts-sched-slot';
    div.style.cssText = 'border-top:1px solid var(--border2);padding-top:14px;margin-top:14px;position:relative';
    div.innerHTML =
        '<button onclick="this.parentElement.remove()" style="position:absolute;right:0;top:14px;background:none;border:none;color:#EF4444;font-size:18px;cursor:pointer">✕</button>' +
        '<div class="field-row">' +
            '<div class="field"><label>День</label>' +
                '<select class="ts-day" style="width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;font-family:inherit">' +
                '<option value="Пн">Понедельник</option><option value="Вт">Вторник</option>' +
                '<option value="Ср">Среда</option><option value="Чт">Четверг</option>' +
                '<option value="Пт">Пятница</option><option value="Сб">Суббота</option><option value="Вс">Воскресенье</option>' +
                '</select></div>' +
            '<div class="field"><label>Начало</label><input type="time" class="ts-from" value="09:00" style="width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;font-family:inherit"></div>' +
            '<div class="field"><label>Конец</label><input type="time" class="ts-to" value="10:00" style="width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;font-family:inherit"></div>' +
        '</div>' +
        '<div class="field"><label>Ссылка</label><input type="url" class="ts-link" placeholder="https://zoom.us/j/..." style="width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;font-family:inherit"></div>';
    container.appendChild(div);
}

async function saveSchedule() {
    if (!currentStudentData) return;
    const slots    = document.querySelectorAll('.ts-sched-slot');
    const days     = Array.from(slots).map(function(s) {
        return {
            dayOfWeek: s.querySelector('.ts-day')?.value  || '',
            timeFrom:  s.querySelector('.ts-from')?.value || '',
            timeTo:    s.querySelector('.ts-to')?.value   || '',
            platform:  s.querySelector('.ts-plat')?.value || '',
            link:      s.querySelector('.ts-link')?.value || '',
        };
    });
    try {
        await post('/courses/' + currentCourseId + '/schedule', {
            enrollmentId: currentStudentData.enrollment.id,
            studentId:    currentStudentId,
            days,
        });
        showToast('📅 Расписание сохранено!');
        await loadStudentPageData();
    } catch(e) { showToast('Ошибка: ' + (e.message||''), 'error'); }
}

function renderTsSchedule(schedule) {
    const el = document.getElementById('ts-sched-current');
    if (!schedule || !schedule.length) { el.innerHTML = ''; return; }
    const DAY_NAMES  = {'Пн':'Понедельник','Вт':'Вторник','Ср':'Среда','Чт':'Четверг','Пт':'Пятница','Сб':'Суббота','Вс':'Воскресенье'};
    const PLAT_ICONS = {zoom:'🎥',meet:'📹',teams:'💼',tg:'✈️',sk:'💬'};
    el.innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:10px">📋 Текущее расписание:</div>' +
        '<div class="cp-sched-grid">' +
        schedule.map(function(s) {
            var dayFull = DAY_NAMES[s.dayOfWeek] || s.dayOfWeek || '—';
            var platIco = PLAT_ICONS[s.platform]  || '🔗';
            var linkBtn = s.link
                ? '<a href="' + s.link + '" target="_blank" class="cp-sched-link">' + platIco + ' Войти</a>'
                : '';
            return '<div class="cp-sched-card">' +
                '<div class="cp-sched-day">' + dayFull + '</div>' +
                '<div class="cp-sched-time">' + (s.timeFrom||'—') + (s.timeTo ? ' – ' + s.timeTo : '') + '</div>' +
                '<div class="cp-sched-plat">' + platIco + ' ' + (s.platform||'') + '</div>' +
                linkBtn + '</div>';
        }).join('') + '</div>';
}

// ── Homework ──
async function addHomework() {
    const title   = document.getElementById('ts-hw-title').value.trim();
    const desc    = document.getElementById('ts-hw-desc').value.trim();
    const due     = document.getElementById('ts-hw-due').value;
    const lessonId = document.getElementById('ts-hw-lesson').value;
    if (!title) { showToast('Введите название задания', 'info'); return; }
    try {
        await post('/teachers/homework', {
            courseId:  currentCourseId,
            studentId: currentStudentId,
            lessonId:  lessonId || null,
            title, description: desc, dueDate: due || null,
        });
        document.getElementById('ts-hw-title').value = '';
        document.getElementById('ts-hw-desc').value  = '';
        document.getElementById('ts-hw-due').value   = '';
        showToast('✅ Задание отправлено ученику!');
        await loadStudentPageData();
    } catch(e) { showToast('Ошибка: ' + (e.message||''), 'error'); }
}

function renderTsHomework(homework) {
    const el    = document.getElementById('ts-hw-list');
    if (!homework || !homework.length) {
        el.innerHTML = '<div class="cp-empty"><div class="cp-empty-ico">📝</div><div class="cp-empty-title">Заданий пока нет</div></div>';
        return;
    }
    const STATUS_LABELS = { pending:'📋 Ожидает', submitted:'✅ Сдано', reviewed:'💬 Проверено' };
    el.innerHTML = homework.map(function(h) {
        var statusLabel = STATUS_LABELS[h.status] || h.status;
        var statusClass = h.status || 'pending';
        var reviewBtn   = h.status === 'submitted'
            ? '<button class="btn-sm solid" onclick="openTsComment(\'' + h.id + '\', \'' + (h.studentAnswer||'').replace(/'/g,"\\'") + '\')">💬 Проверить</button>'
            : '';
        return '<div class="cp-hw-card ' + statusClass + '" style="margin-bottom:10px">' +
            '<div class="cp-hw-hdr">' +
                '<div class="cp-hw-ico">📝</div>' +
                '<div style="flex:1"><div class="cp-hw-title">' + h.title + '</div>' +
                '<div class="cp-hw-meta">' + (h.lessonTitle ? h.lessonTitle + ' · ' : '') +
                (h.dueDate ? '📅 До ' + new Date(h.dueDate).toLocaleDateString('ru',{day:'numeric',month:'short'}) : '') + '</div></div>' +
                '<span class="cp-hw-status ' + statusClass + '">' + statusLabel + '</span>' +
            '</div>' +
            (h.studentAnswer ? '<div class="cp-hw-answer">💬 Ответ ученика: ' + h.studentAnswer + '</div>' : '') +
            (h.teacherComment ? '<div class="cp-hw-comment">👨‍🏫 Ваш комментарий: ' + h.teacherComment + '</div>' : '') +
            reviewBtn +
        '</div>';
    }).join('');
}

function openTsComment(hwId, studentAnswer) {
    currentTsHwId = hwId;
    document.getElementById('ts-student-answer').textContent = studentAnswer || '(ответ не указан)';
    document.getElementById('ts-comment-text').value = '';
    document.getElementById('ts-comment-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeTsComment() {
    document.getElementById('ts-comment-modal').classList.remove('open');
    document.body.style.overflow = '';
}
async function saveHwComment() {
    var comment = document.getElementById('ts-comment-text').value.trim();
    if (!comment) { showToast('Напишите комментарий', 'info'); return; }
    try {
        await put('/teachers/homework/' + currentTsHwId + '/comment', { comment });
        closeTsComment();
        showToast('✅ Комментарий отправлен!');
        await loadStudentPageData();
    } catch(e) { showToast('Ошибка: ' + (e.message||''), 'error'); }
}


// ═══════════════════════════════════════════════════════
// POLLING УВЕДОМЛЕНИЙ НА СТРАНИЦЕ КУРСА
// ═══════════════════════════════════════════════════════
var courseChatPollInterval = null;

function startCourseChatPoll(otherUserId, btnId) {
    stopCourseChatPoll();
    // Check immediately
    checkCourseChat(otherUserId, btnId);
    // Then every 5 seconds
    courseChatPollInterval = setInterval(function() {
        checkCourseChat(otherUserId, btnId);
    }, 5000);
}

function stopCourseChatPoll() {
    if (courseChatPollInterval) {
        clearInterval(courseChatPollInterval);
        courseChatPollInterval = null;
    }
}

async function checkCourseChat(otherUserId, btnId) {
    if (!currentUser || !otherUserId) return;
    try {
        var chats = await get('/users/chats');
        var chat  = chats.find(function(c) { return c.id === otherUserId; });
        var unread = chat ? (parseInt(chat.unread) || 0) : 0;
        var btn   = document.getElementById(btnId);
        if (!btn) return;

        // Remove old badge if exists
        var oldBadge = btn.querySelector('.chat-page-badge');
        if (oldBadge) oldBadge.remove();

        if (unread > 0) {
            var badge = document.createElement('span');
            badge.className = 'chat-page-badge';
            badge.textContent = unread;
            badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;' +
                'background:#EF4444;color:#fff;border-radius:50%;' +
                'width:18px;height:18px;font-size:11px;font-weight:800;' +
                'margin-left:6px;animation:pulse 1.5s infinite;';
            btn.appendChild(badge);

            // Update button text to show unread
            btn.style.borderColor = '#EF4444';
            btn.style.color       = '#EF4444';
        } else {
            btn.style.borderColor = '';
            btn.style.color       = '';
        }
    } catch(e) {}
}

// ═══════════════════════════════════════════════════════
// СТРАНИЦА КУРСА
// ═══════════════════════════════════════════════════════
let currentCourseId  = null;
let currentCourseData = null;
let currentHwId      = null;

async function openCourse(courseId) {
    if (!currentUser) { go('login'); return; }
    currentCourseId = courseId;
    go('course');
    await loadCourseData();
    // Start polling for new messages from teacher
    // teacherId is set after loadCourseData in currentCourseData
    if (currentCourseData && currentCourseData.course && currentCourseData.course.teacher) {
        startCourseChatPoll(currentCourseData.course.teacher.id, 'cp-chat-btn');
    }
}

function openChatFromCourse() {
    if (!currentCourseData) return;
    const teacherId = currentCourseData.course.teacher.id;
    const teacher   = currentCourseData.course.teacher;
    chatTeacherId   = teacherId;
    // Clear badge immediately
    var btn = document.getElementById('cp-chat-btn');
    if (btn) {
        var b = btn.querySelector('.chat-page-badge');
        if (b) b.remove();
        btn.style.borderColor = '';
        btn.style.color = '';
    }
    const nameEl = document.getElementById('chat-name');
    const avEl   = document.getElementById('chat-av');
    if (nameEl) nameEl.textContent = teacher.firstName + ' ' + teacher.lastName;
    if (avEl)   { avEl.textContent = teacher.initials; avEl.style.background = teacher.color; }
    const modal = document.getElementById('chat-modal');
    if (modal) modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    loadMessages();
    if (chatInterval) clearInterval(chatInterval);
    chatInterval = setInterval(loadMessages, 4000);
}

async function loadCourseData() {
    try {
        const data = await get('/courses/' + currentCourseId + '/my');
        currentCourseData = data;
        renderCoursePage(data);
        // Start polling for new messages from teacher
        if (data.course && data.course.teacher) {
            startCourseChatPoll(data.course.teacher.id, 'cp-chat-btn');
        }
    } catch(e) {
        console.error('loadCourseData:', e);
        if (e.status === 403) {
            showToast('Вы не записаны на этот курс', 'error');
            go('student-dash'); loadStudentDash(); sdShow('my-courses');
        } else {
            showToast('Ошибка загрузки курса: ' + (e.message || ''), 'error');
        }
    }
}

function renderCoursePage(data) {
    const { course, progress, lessons, homework, materials, schedule, teacher } = data;

    // Breadcrumb & hero
    document.getElementById('cp-bc-title').textContent  = course.title;
    document.getElementById('cp-emoji').textContent     = course.emoji || '📖';
    document.getElementById('cp-cat').textContent       = course.category;
    document.getElementById('cp-title').textContent     = course.title;
    document.getElementById('cp-level').textContent     = course.level;

    // Teacher avatar
    const avEl = document.getElementById('cp-teacher-av');
    if (avEl) {
        if (course.teacher.avatarUrl) {
            avEl.innerHTML = '<img src="' + course.teacher.avatarUrl + '" style="width:100%;height:100%;object-fit:cover">';
        } else {
            avEl.textContent = course.teacher.initials || '?';
            avEl.style.background = course.teacher.color || '#18A96A';
        }
    }
    document.getElementById('cp-teacher-name').textContent = course.teacher.firstName + ' ' + course.teacher.lastName;

    // Progress ring
    const pct = progress.percent || 0;
    const circumference = 201;
    const offset = circumference - (circumference * pct / 100);
    const ringEl = document.getElementById('cp-ring-fill');
    if (ringEl) setTimeout(() => { ringEl.style.strokeDashoffset = offset; }, 100);
    document.getElementById('cp-pct').textContent = pct + '%';

    // Progress bar
    const pbFill = document.getElementById('cp-pb-fill');
    const pbText = document.getElementById('cp-pb-text');
    if (pbFill) pbFill.style.width = pct + '%';
    if (pbText) pbText.textContent = progress.done + ' из ' + progress.total + ' уроков';

    // Render lessons
    renderLessons(lessons);

    // Render schedule
    renderSchedule(schedule, teacher);

    // Render homework
    renderHomework(homework);

    // Render materials
    renderMaterials(materials);

    // Reset to lessons tab
    cpTab('lessons', document.querySelector('.cp-tab.on') || document.querySelector('.cp-tab'));
}

function renderLessons(lessons) {
    const el = document.getElementById('cp-lessons-list');
    if (!lessons.length) {
        el.innerHTML = '<div class="cp-empty"><div class="cp-empty-ico">📚</div><div class="cp-empty-title">Уроков пока нет</div><div class="cp-empty-sub">Преподаватель добавит уроки по ходу курса</div></div>';
        return;
    }
    el.innerHTML = lessons.map(function(l) {
        return '<div class="cp-lesson' + (l.isDone ? ' done' : '') + '" id="lesson-' + l.id + '">' +
            '<div class="cp-lesson-num">' + (l.isDone ? '✓' : l.order) + '</div>' +
            '<div class="cp-lesson-info">' +
                '<div class="cp-lesson-title">' + l.title + '</div>' +
                '<div class="cp-lesson-meta">' + (l.isDone && l.doneAt ? 'Пройдено ' + new Date(l.doneAt).toLocaleDateString('ru', {day:'numeric',month:'short'}) : 'Урок ' + l.order) + '</div>' +
            '</div>' +
            '<div class="cp-lesson-check" onclick="toggleLesson(\'' + l.id + '\', ' + (!l.isDone) + ', event)" title="' + (l.isDone ? 'Отметить не пройденным' : 'Отметить пройденным') + '">' +
                (l.isDone ? '✓' : '') +
            '</div>' +
        '</div>';
    }).join('');
}

async function toggleLesson(lessonId, isDone, e) {
    e.stopPropagation();
    try {
        const result = await post('/courses/' + currentCourseId + '/progress', { lessonId, isDone });
        // Update UI
        const lessonEl = document.getElementById('lesson-' + lessonId);
        if (lessonEl) {
            lessonEl.classList.toggle('done', isDone);
            const numEl  = lessonEl.querySelector('.cp-lesson-num');
            const chkEl  = lessonEl.querySelector('.cp-lesson-check');
            const metaEl = lessonEl.querySelector('.cp-lesson-meta');
            const order  = lessonEl.querySelector('.cp-lesson-num').textContent;
            if (numEl)  numEl.textContent  = isDone ? '✓' : (result.done);
            if (chkEl)  chkEl.textContent  = isDone ? '✓' : '';
            if (metaEl) metaEl.textContent = isDone ? 'Пройдено сейчас' : 'Урок';
        }
        // Update progress
        const pct = result.percent;
        document.getElementById('cp-pct').textContent = pct + '%';
        document.getElementById('cp-pb-fill').style.width = pct + '%';
        document.getElementById('cp-pb-text').textContent = result.done + ' из ' + result.total + ' уроков';
        const offset = 201 - (201 * pct / 100);
        const ringEl = document.getElementById('cp-ring-fill');
        if (ringEl) ringEl.style.strokeDashoffset = offset;
        showToast(isDone ? '✅ Урок отмечен как пройденный' : 'Урок отмечен как непройденный', isDone ? 'success' : 'info');
    } catch(ex) { showToast('Ошибка: ' + ex.message, 'error'); }
}

function renderSchedule(schedule, teacher) {
    const grid  = document.getElementById('cp-schedule-grid');
    const empty = document.getElementById('cp-sched-empty');
    const info  = document.getElementById('cp-teach-info');

    const DAY_NAMES = { 'Пн':'Понедельник','Вт':'Вторник','Ср':'Среда','Чт':'Четверг','Пт':'Пятница','Сб':'Суббота','Вс':'Воскресенье' };
    const PLAT_ICONS = { zoom:'🎥', meet:'📹', teams:'💼', tg:'✈️', sk:'💬' };

    if (schedule && schedule.length) {
        empty.style.display = 'none';
        grid.innerHTML = '<div class="cp-sched-grid">' +
            schedule.map(function(s) {
                var dayFull = DAY_NAMES[s.dayOfWeek] || s.dayOfWeek || '—';
                var platIco = PLAT_ICONS[s.platform] || '🔗';
                var linkBtn = s.link ? '<a href="' + s.link + '" target="_blank" class="cp-sched-link">' + platIco + ' Войти</a>' : '';
                return '<div class="cp-sched-card">' +
                    '<div class="cp-sched-day">' + dayFull + '</div>' +
                    '<div class="cp-sched-time">' + (s.timeFrom || '—') + (s.timeTo ? ' – ' + s.timeTo : '') + '</div>' +
                    '<div class="cp-sched-plat">' + platIco + ' ' + (s.platform || '') + '</div>' +
                    linkBtn +
                    (s.notes ? '<div style="font-size:11px;color:var(--text3);margin-top:6px">' + s.notes + '</div>' : '') +
                    '</div>';
            }).join('') +
        '</div>';
    } else {
        empty.style.display = '';
        grid.innerHTML = '';
    }

    // Show teacher info (days from profile)
    if (teacher && (teacher.workDays.length || teacher.workHours)) {
        info.style.display = '';
        var daysEl = document.getElementById('cp-teach-days');
        var platsEl = document.getElementById('cp-teach-platforms');
        if (daysEl && teacher.workDays.length) {
            daysEl.innerHTML = '<div style="font-size:12px;color:var(--text2);margin-bottom:6px"><b>Рабочие дни по профилю:</b> ' + teacher.workDays.join(', ') + (teacher.workHours ? ' · ' + teacher.workHours : '') + '</div>';
        }
        if (platsEl && teacher.platforms.length) {
            var platMap = {zoom:'Zoom', meet:'Google Meet', teams:'MS Teams', tg:'Telegram', sk:'Skype'};
            platsEl.innerHTML = '<div style="font-size:12px;color:var(--text2)"><b>Платформы:</b> ' + teacher.platforms.map(function(p){ return platMap[p]||p; }).join(', ') + '</div>';
        }
    } else {
        info.style.display = 'none';
    }
}

function renderHomework(homework) {
    const el    = document.getElementById('cp-hw-list');
    const empty = document.getElementById('cp-hw-empty');
    if (!homework.length) { empty.style.display = ''; el.innerHTML = ''; return; }
    empty.style.display = 'none';
    const STATUS_LABELS = { pending: '📋 Ожидает', submitted: '✅ Сдано', reviewed: '💬 Проверено' };
    el.innerHTML = homework.map(function(h) {
        var statusClass = h.status || 'pending';
        var statusLabel = STATUS_LABELS[statusClass] || statusClass;
        var due = h.dueDate ? '<span style="color:#D97706">📅 До ' + new Date(h.dueDate).toLocaleDateString('ru',{day:'numeric',month:'short'}) + '</span>' : '';
        var answerBlock = h.studentAnswer ? '<div class="cp-hw-answer">💬 Ваш ответ: ' + h.studentAnswer + '</div>' : '';
        var commentBlock = h.teacherComment ? '<div class="cp-hw-comment">👨‍🏫 Комментарий: ' + h.teacherComment + '</div>' : '';
        var submitBtn = (h.status === 'pending' || !h.status)
            ? '<button class="btn-sm solid" onclick="openHwModal(\'' + h.id + '\', \'' + h.title.replace(/'/g,"\\'") + '\', \'' + (h.description||'').replace(/'/g,"\\'") + '\')">📤 Сдать задание</button>'
            : '';
        return '<div class="cp-hw-card ' + statusClass + '">' +
            '<div class="cp-hw-hdr">' +
                '<div class="cp-hw-ico">📝</div>' +
                '<div style="flex:1">' +
                    '<div class="cp-hw-title">' + h.title + '</div>' +
                    '<div class="cp-hw-meta">' + (h.lessonTitle ? h.lessonTitle + ' · ' : '') + due + '</div>' +
                '</div>' +
                '<span class="cp-hw-status ' + statusClass + '">' + statusLabel + '</span>' +
            '</div>' +
            (h.description ? '<div class="cp-hw-desc">' + h.description + '</div>' : '') +
            answerBlock + commentBlock + submitBtn +
        '</div>';
    }).join('');
}

function renderMaterials(materials) {
    const el    = document.getElementById('cp-mat-list');
    const empty = document.getElementById('cp-mat-empty');
    if (!materials || !materials.length) {
        if (empty) empty.style.display = '';
        if (el)    el.innerHTML = '';
        return;
    }
    if (empty) empty.style.display = 'none';
    const TYPE_ICONS = {
        pdf:'📄', doc:'📝', docx:'📝', ppt:'📊', pptx:'📊',
        xls:'📈', xlsx:'📈', jpg:'🖼️', jpeg:'🖼️', png:'🖼️',
        mp4:'🎬', mp3:'🎵', zip:'🗜️', rar:'🗜️', txt:'📋', csv:'📊'
    };
    el.innerHTML = materials.map(function(m) {
        // Use fileType field from DB (set during upload), fallback to URL extension
        var ext = m.fileType || (m.fileUrl ? m.fileUrl.split('?')[0].split('.').pop().toLowerCase() : '');
        var ico  = TYPE_ICONS[ext] || '📎';
        var size = m.fileSize
            ? (m.fileSize > 1024*1024
                ? (m.fileSize/1024/1024).toFixed(1)+' МБ'
                : (m.fileSize/1024).toFixed(0)+' КБ')
            : '';
        var date = m.createdAt
            ? new Date(m.createdAt).toLocaleDateString('ru',{day:'numeric',month:'short'})
            : '';
        var tag  = m.fileUrl ? 'a' : 'div';
        var href = m.fileUrl ? ' href="' + m.fileUrl + '" target="_blank"' : '';
        return '<' + tag + href + ' class="cp-mat-card">' +
            '<div class="cp-mat-ico">' + ico + '</div>' +
            '<div class="cp-mat-info">' +
                '<div class="cp-mat-title">' + m.title + '</div>' +
                '<div class="cp-mat-meta">' +
                    (m.lessonTitle ? m.lessonTitle + ' · ' : '') +
                    (size ? size + ' · ' : '') + date +
                    (ext ? ' · ' + ext.toUpperCase() : '') +
                '</div>' +
            '</div>' +
            (m.fileUrl ? '<div class="cp-mat-dl">⬇️ Скачать</div>' : '') +
        '</' + tag + '>';
    }).join('');
}

function cpTab(tab, btn) {
    // Scope to page-course only (don't affect teacher-student page tabs)
    document.querySelectorAll('#page-course .cp-tab').forEach(function(t){ t.classList.remove('on'); });
    if (btn) btn.classList.add('on');
    document.querySelectorAll('#page-course .cp-section').forEach(function(s){ s.classList.remove('on'); });
    var sec = document.getElementById('cps-' + tab);
    if (sec) sec.classList.add('on');
}

function openHwModal(hwId, title, desc) {
    currentHwId = hwId;
    document.getElementById('hw-modal-title').textContent  = title;
    document.getElementById('hw-modal-desc').textContent   = desc || 'Выполните задание и напишите ответ ниже';
    document.getElementById('hw-modal-answer').value = '';
    document.getElementById('hw-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(function(){ document.getElementById('hw-modal-answer').focus(); }, 100);
}

function closeHwModal() {
    document.getElementById('hw-modal').classList.remove('open');
    document.body.style.overflow = '';
}

async function submitHomework() {
    var answer = document.getElementById('hw-modal-answer').value.trim();
    if (!answer) { showToast('Напишите ответ', 'info'); return; }
    try {
        await post('/courses/' + currentCourseId + '/homework/' + currentHwId + '/submit', { answer });
        closeHwModal();
        showToast('✅ Домашнее задание сдано!');
        await loadCourseData(); // Refresh
    } catch(ex) { showToast('Ошибка: ' + ex.message, 'error'); }
}

// ═══════════════════════════════════════════════════════
// MOBILE NAVIGATION
// ═══════════════════════════════════════════════════════
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const ham  = document.getElementById('nav-ham');
    const isOpen = menu.classList.toggle('open');
    ham.setAttribute('aria-expanded', isOpen);
    // sync guest/user state
    const isLoggedIn = !!currentUser;
    const guestEl = document.getElementById('mob-menu-guest');
    const userEl  = document.getElementById('mob-menu-user');
    if (guestEl) guestEl.style.display = isLoggedIn ? 'none' : '';
    if (userEl)  userEl.style.display  = isLoggedIn ? 'block' : 'none';
}

function closeMobileMenu() {
    document.getElementById('mobile-menu')?.classList.remove('open');
}

// Mobile dash panel label map
const SD_LABELS = {
    'overview': 'Обзор', 'my-courses': 'Мои курсы', 'balance': 'Баланс',
    'favorites': 'Избранное', 'chats': '💬 Сообщения', 'notifications': 'Уведомления',
    'settings': 'Настройки', 'payment-flow': 'Оплата'
};
const TD_LABELS = {
    't-overview': 'Обзор', 't-courses': 'Мои курсы', 't-students': 'Ученики',
    't-chats': '💬 Сообщения', 't-add-course': 'Добавить курс', 't-earnings': 'Доходы',
    't-notifs': 'Уведомления', 't-profile': 'Профиль', 't-docs': 'Документы'
};

function setMobNav(panel, prefix) {
    // Update active bottom nav item
    const navId = prefix === 'sd' ? 'sd-mob-nav' : 'td-mob-nav';
    const navEl = document.getElementById(navId);
    if (navEl) {
        navEl.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('on'));
        const btnId = prefix === 'sd' ? 'mni-' + panel : 'tmni-' + panel;
        document.getElementById(btnId)?.classList.add('on');
    }
    // Update title
    const titleId = prefix === 'sd' ? 'sd-mob-title' : 'td-mob-title';
    const labels  = prefix === 'sd' ? SD_LABELS : TD_LABELS;
    const titleEl = document.getElementById(titleId);
    if (titleEl) titleEl.textContent = labels[panel] || panel;
}

// Close mobile menu when clicking outside
document.addEventListener('click', function(e) {
    const menu = document.getElementById('mobile-menu');
    const ham  = document.getElementById('nav-ham');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target) && e.target !== ham && !ham?.contains(e.target)) {
        closeMobileMenu();
    }
});

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
        showToast('Фото обновлено');
    } catch(e) {
        alert('Ошибка загрузки: ' + e.message);
    }
}

init();
