// ═══════════════════════════════════════════════════════
// EduSpace.tj — Frontend App
// ═══════════════════════════════════════════════════════

const API = 'https://eduspacetj-production.up.railway.app/api';

// ─── HTTP helpers ─────────────────────────────────────
async function req(method, url, data = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
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
let pendingCourseId = localStorage.getItem('pendingCourseId') || null;
let currentProfileId = localStorage.getItem('pendingProfileId') || null;
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

    // Обработка ссылки сброса пароля: #reset-password?token=XXX
    if (hash.startsWith('reset-password')) {
        var params = new URLSearchParams(hash.replace('reset-password?', ''));
        var resetTok = params.get('token');
        if (resetTok) { openResetPage(resetTok); return; }
    }

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


// ── Навигация ──
var prevPage    = null;
var currentPage = 'home';

function goBack() {
    if (prevPage) go(prevPage);
    else if (currentUser) goDash();
    else go('home');
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

    // Запоминаем предыдущую страницу для goBack()
    if (!skipHistory && typeof currentPage !== 'undefined' && currentPage !== p) {
        prevPage = currentPage;
    }
    currentPage = p;

    if (p === 'catalog') loadCatalog();
    if (p === 'home') loadHomeStats();
}





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
            av.style.overflow = 'hidden';
            av.innerHTML = '<img src="' + t.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit">';
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
                '</' + tag + '>' +
            (isTeach ? '<button onclick="deleteCourseMaterial(\'' + m.id + '\')" style="background:none;border:none;color:#EF4444;font-size:18px;cursor:pointer;padding:8px;flex-shrink:0;opacity:.7" title="Удалить материал">🗑</button>' : '') +
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

    // Проверяем куплены ли все курсы этого учителя
    if (enrollBtn && currentUser && currentUser.role === 'student' && t.courses && t.courses.length > 0) {
        get('/payments/enrollments').then(function(enrollments) {
            var enrolledCourseIds = enrollments.map(function(e) { return e.course_id; });
            var activeCourses = t.courses.filter(function(c) { return c.status === 'active'; });
            var allBought = activeCourses.length > 0 && activeCourses.every(function(c) {
                return enrolledCourseIds.includes(c.id);
            });
            if (allBought) {
                // Все курсы куплены — заменяем кнопку
                enrollBtn.textContent = '✅ Вы уже записаны';
                enrollBtn.disabled = true;
                enrollBtn.style.background = 'var(--bg)';
                enrollBtn.style.color = 'var(--g2)';
                enrollBtn.style.border = '1.5px solid var(--g)';
                enrollBtn.style.cursor = 'default';
                if (topEnroll) {
                    topEnroll.textContent = '✅ Записан';
                    topEnroll.disabled = true;
                }
            }
        }).catch(function(){});
    }
}

function buildReviewCard(r, isTeacher) {
    // Студент видит форму только под своим отзывом; учитель — под любым
    var isMyReview = currentUser && (
        isTeacher ||
        (currentUser.role === 'student' && r.studentId === currentUser.id)
    );
    var placeholder = isTeacher ? 'Ответить ученику...' : 'Написать комментарий...';
    return '<div class="ri-card" id="rev-card-' + r.id + '">' +
        '<div class="ri-top">' +
            '<div class="ri-av" style="background:' + (r.student?.color||'#18A96A') + ';overflow:hidden;padding:0">' + avHtml(r.student) + '</div>' +
            '<div class="ri-meta"><div class="ri-name">' + (r.student?.name||'Ученик') + '</div>' +
            '<div class="ri-sub">' + new Date(r.date).toLocaleDateString('ru',{day:'numeric',month:'long',year:'numeric'}) + (r.courseTitle ? ' · ' + r.courseTitle : '') + '</div></div>' +
            '<div class="ri-stars">' + '★'.repeat(r.stars) + '</div>' +
        '</div>' +
        '<div class="ri-text">' + (r.text||'') + '</div>' +
        ((r.tags||[]).length ? '<div class="ri-tags">' + r.tags.map(function(tag){ return '<span class="ri-tag">' + tag + '</span>'; }).join('') + '</div>' : '') +
        '<div class="rev-thread" id="rev-thread-' + r.id + '"><div style="font-size:12px;color:var(--text3);padding:.5rem 0">⏳</div></div>' +
        (isMyReview ?
            '<div class="rev-comment-form">' +
                '<textarea class="rev-comment-ta" id="rev-ta-' + r.id + '" placeholder="' + placeholder + '" rows="2"></textarea>' +
                '<button class="rev-comment-send" onclick="submitRevComment(\'' + r.id + '\')">Отправить</button>' +
            '</div>'
        : '') +
    '</div>';
}

function renderRevList(reviews, months) {
    var now = new Date();
    var fl = months === 0 ? reviews : reviews.filter(function(r){ return (now - new Date(r.date)) / (1000*60*60*24*30) <= months; });
    var isTeacher = currentUser && currentUser.role === 'teacher' && currentUser.id === currentProfileId;
    var el = document.getElementById('pp-rev-list');
    if (!fl.length) { el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">Отзывов пока нет</div>'; return; }
    el.innerHTML = fl.map(function(r){ return buildReviewCard(r, isTeacher); }).join('');
    fl.forEach(function(r){ loadRevThread(r.id); });
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
    localStorage.setItem('pendingCourseId', courseId);
    if (currentProfileId) localStorage.setItem('pendingProfileId', currentProfileId);
    go('student-dash'); loadStudentDash(); sdShow('payment-flow');
}

function goPayForProfileById(id) {
    currentProfileId = id;
    goPayForProfile();
}

function goPayForProfile() {
    if (!currentUser) { go('login'); return; }
    if (currentUser.role === 'teacher') { showToast('Преподаватели не могут записываться на курсы', 'info'); return; }

    Promise.all([
        get('/teachers/' + currentProfileId),
        get('/payments/enrollments')
    ]).then(function(results) {
        var t = results[0];
        var enrollments = results[1];
        var enrolledIds = enrollments.map(function(e) { return e.course_id; });

        // Фильтруем — только активные и ещё не купленные
        var availableCourses = (t.courses || []).filter(function(c) {
            return c.status === 'active' && !enrolledIds.includes(c.id);
        });

        if (!availableCourses.length) {
            showToast('✅ Вы уже записаны на все курсы этого преподавателя', 'info');
            return;
        }
        if (availableCourses.length === 1) {
            selectCourseForPayment(availableCourses[0].id);
        } else {
            showCourseSelectModal(availableCourses);
        }
    }).catch(function(){});
}

function showCourseSelectModal(courses) {
    var list = document.getElementById('course-select-list');
    if (!list) return;

    list.innerHTML = courses.map(function(c) {
        return '<div onclick="selectCourseForPayment(\'' + c.id + '\')" style="display:flex;align-items:center;justify-content:space-between;padding:14px;border:1.5px solid var(--border);border-radius:12px;cursor:pointer;transition:all .2s" onmouseover="this.style.borderColor=\'var(--g)\';this.style.background=\'var(--gl2)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'\'">'+
            '<div style="display:flex;align-items:center;gap:12px">'+
                '<div style="font-size:24px">' + (c.emoji || '📖') + '</div>'+
                '<div>'+
                    '<div style="font-size:14px;font-weight:700">' + c.title + '</div>'+
                    '<div style="font-size:12px;color:var(--text3);margin-top:2px">' + (c.category || '') + ' · ' + (c.level || '') + '</div>'+
                '</div>'+
            '</div>'+
            '<div style="text-align:right;flex-shrink:0">'+
                '<div style="font-size:15px;font-weight:800;color:var(--g2)">' + parseFloat(c.price).toLocaleString('ru') + ' смн</div>'+
                '<div style="font-size:11px;color:var(--text3)">в месяц</div>'+
            '</div>'+
        '</div>';
    }).join('');

    var modal = document.getElementById('course-select-modal');
    if (modal) modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeCourseSelectModal() {
    var modal = document.getElementById('course-select-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function selectCourseForPayment(courseId) {
    closeCourseSelectModal();
    pendingCourseId = courseId;
    localStorage.setItem('pendingCourseId', courseId);
    if (currentProfileId) localStorage.setItem('pendingProfileId', currentProfileId);
    go('student-dash');
    loadStudentDash();
    sdShow('payment-flow');
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
    startStudentNotifPoll();
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
        el.innerHTML = '<div class="cg">' + enrollments.map(function(e) {
            var cid = e.course_id || e.id;
            var avInner = e.avatar_url
                ? '<img src="' + e.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">'
                : (e.initials || '?');
            return '<div class="ccard" onclick="openCourse(\'' + cid + '\')" style="cursor:pointer">' +
                '<div class="ccard-img">' + (e.emoji || '📖') + '</div>' +
                '<div class="ccard-body">' +
                    '<div class="ccard-cat">' + (e.category || '') + '</div>' +
                    '<div class="ccard-title">' + e.title + '</div>' +
                    '<div class="ccard-teacher"><div class="t-dot" style="background:' + (e.color||'#18A96A') + ';overflow:hidden;padding:0">' + avInner + '</div>' + e.first_name + ' ' + e.last_name + '</div>' +
                '</div>' +
                '<div class="ccard-foot">' +
                    '<div class="ccard-price">' + parseFloat(e.price).toLocaleString('ru') + ' смн</div>' +
                    '<button class="ccard-enroll" onclick="event.stopPropagation();openCourse(\'' + cid + '\')">Продолжить →</button>' +
                '</div>' +
            '</div>';
        }).join('') + '</div>';
    } catch(e) { console.error(e); }
}

async function loadFavorites() {
    try {
        const favs = await get('/users/favorites');
        const el = document.getElementById('sd-fav-list');
        if (!favs.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">♡</div><div class="empty-title">Избранное пусто</div><div class="empty-sub">Нажмите ♡ на профиле преподавателя</div><button class="btn-lg green" onclick="go(\'catalog\')">Каталог</button></div>'; return; }
        el.innerHTML = '<div class="tc-grid">' + favs.map(t => buildTccard({
            id: t.id, firstName: t.first_name, lastName: t.last_name, fullName: t.first_name+' '+t.last_name,
            initials: t.initials, color: t.color, avatarUrl: t.avatar_url||null, subject: t.subject, rating: t.rating, reviewCount: t.review_count, studentCount: t.student_count, price: t.price, isModerated: !!t.is_moderated
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

async function goToReviewTab(teacherUserId) {
    // 1. Закрываем панель уведомлений
    var sdpNotif = document.getElementById('sdp-notifications');
    if (sdpNotif && sdpNotif.classList.contains('on')) sdShow('overview');

    // 2. Открываем профиль учителя (ждём завершения)
    await openProfile(teacherUserId);

    // 3. Ждём рендер профиля, затем переключаем на вкладку "Отзывы"
    setTimeout(function() {
        // Ищем кнопку вкладки "Отзывы" среди .pp-tab
        var revTabBtn = null;
        document.querySelectorAll('.pp-tab').forEach(function(btn) {
            if (btn.textContent.trim().includes('Отзыв')) revTabBtn = btn;
        });
        if (revTabBtn) {
            // Вызываем ppTab напрямую
            ppTab('pp-reviews', revTabBtn);

            // 4. После загрузки отзывов — скролл к первой форме комментария
            setTimeout(function() {
                var firstForm = document.querySelector('#pp-reviews .rev-comment-form');
                if (firstForm) {
                    firstForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    var ta = firstForm.querySelector('textarea');
                    if (ta) { ta.focus(); }
                } else {
                    // Если форм нет — просто скролл к секции отзывов
                    var revSection = document.getElementById('pp-reviews');
                    if (revSection) revSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 700);
        }
    }, 600);
}


// Вызывается когда заявка одобрена и студент нажимает "Продолжить"
async function onBalanceApproved() {
    try {
        const bal = await get('/payments/balance');
        currentUser.balance = bal.balance;
        localStorage.setItem('user', JSON.stringify(currentUser));
        showLoggedIn();

        if (pendingCourseId) {
            // Есть курс → идём к оплате (баланс уже пополнен)
            sdShow('payment-flow');
            await initPayFlow();
        } else if (currentProfileId) {
            // Пришёл через учителя → профиль учителя
            openProfile(currentProfileId);
        } else {
            // Пришёл сам → каталог
            go('catalog');
        }
    } catch(e) { showToast('Ошибка: ' + (e.message||''), 'error'); }
}

function onTopupNotifClick() {
    get('/payments/balance').then(function(bal) {
        currentUser.balance = bal.balance;
        localStorage.setItem('user', JSON.stringify(currentUser));
        showLoggedIn();
        sdShow('overview');

        // Восстанавливаем из localStorage если потерялось
        if (!pendingCourseId) pendingCourseId = localStorage.getItem('pendingCourseId');
        if (!currentProfileId) currentProfileId = localStorage.getItem('pendingProfileId');

        if (pendingCourseId) {
            // Есть курс → сразу на страницу оплаты
            sdShow('payment-flow');
            initPayFlow();
        } else if (currentProfileId) {
            openProfile(currentProfileId);
        } else {
            go('catalog');
        }
    }).catch(function(){});
}

// Показать кнопку "Продолжить" после успешной заявки
function _showContinueBtn() {
    var histEl = document.getElementById('tr-history');
    if (!histEl) return;
    // Кнопка появится в loadTopupHistory после отправки заявки
}

function closeNotifPanel() {
    // Для студента - закрываем панель уведомлений, переходя на overview
    var currentPage = document.querySelector('.page.active') || document.querySelector('[id^="page-"].active');
    // просто убираем активную панель уведомлений если открыта
    var sdpNotif = document.getElementById('sdp-notifications');
    var tdpNotif = document.getElementById('tdp-t-notifs');
    if (sdpNotif && sdpNotif.classList.contains('on')) {
        sdShow('overview');
    }
    if (tdpNotif && tdpNotif.classList.contains('on')) {
        // ничего, tdShow вызовется снаружи
    }
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
            if (n.type === 'new_message')    ico = '💬';
            if (n.type === 'homework')       ico = '📝';
            if (n.type === 'new_material')   ico = '📎';
            if (n.type === 'topup')          ico = '💳';
            if (n.type === 'welcome')        ico = '🎉';
            if (n.type === 'review_comment') ico = '⭐';
            var timeStr = new Date(n.created_at).toLocaleDateString('ru',{day:'numeric',month:'short'});
            var clickHandler = '';
            if (n.type === 'review_comment' && n.link) {
                // Студент: профиль учителя → вкладка "Отзывы" → скролл к форме комментариев
                clickHandler = ' onclick="goToReviewTab(\'' + n.link + '\')" style="cursor:pointer;transition:background .15s" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'\'"';
            }
            return '<div class="notif-item' + (n.is_read ? '' : ' notif-unread') + '"' + clickHandler + '>' +
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
    document.getElementById('pf-topup').style.display = 'none';
    document.getElementById('pf-checkout').style.display = 'none';
    document.getElementById('pf-success').style.display = 'none';
    try {
        const bal = await get('/payments/balance');
        currentUser.balance = bal.balance;

        if (pendingCourseId) {
            // Есть курс для покупки
            const c = await get('/courses/' + pendingCourseId);
            if (bal.balance >= c.price) {
                // Баланса хватает — сразу показываем checkout
                document.getElementById('pf-checkout').style.display = 'block';
                await renderCheckout(pendingCourseId, bal.balance);
            } else {
                // Баланса не хватает — показываем форму заявки на пополнение
                var shortage = c.price - bal.balance;
                document.getElementById('pf-topup').style.display = 'block';
                // Показываем инфо о нехватке
                var infoEl = document.getElementById('topup-shortage-info');
                if (infoEl) {
                    infoEl.style.display = 'block';
                    infoEl.innerHTML =
                        '<div style="background:#f0fdf4;border:1.5px solid var(--g);border-radius:12px;padding:14px;margin-bottom:14px">' +
                            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
                                '<div style="font-size:24px">' + (c.emoji||'📖') + '</div>' +
                                '<div><div style="font-size:14px;font-weight:800">' + c.title + '</div>' +
                                '<div style="font-size:12px;color:var(--text3)">' + (c.category||'') + '</div></div>' +
                                '<div style="margin-left:auto;text-align:right"><div style="font-size:18px;font-weight:800;color:var(--g2)">' + parseFloat(c.price).toLocaleString('ru') + ' смн</div>' +
                                '<div style="font-size:11px;color:var(--text3)">стоимость курса</div></div>' +
                            '</div>' +
                            (bal.balance > 0 ?
                                '<div style="font-size:12px;color:var(--text2);padding:8px;background:rgba(0,0,0,.04);border-radius:8px">' +
                                '💰 Ваш баланс: <b>' + bal.balance + ' смн</b> · Нужно пополнить минимум на <b>' + shortage + ' смн</b></div>'
                            : '') +
                            '<div style="font-size:12px;color:var(--text3);margin-top:8px">✅ После одобрения курс будет куплен автоматически. Остаток зачислится на баланс.</div>' +
                        '</div>';
                    // Предзаполняем сумму (минимум нужная сумма)
                    var amtInput = document.getElementById('tr-amount');
                    if (amtInput) amtInput.value = shortage;
                }
                // Инициализируем выбор метода
                selectTopupMethod('alif_mobi');
                // Загружаем историю заявок
                loadTopupHistory();
            }
        } else {
            // Нет конкретного курса — просто форма пополнения
            document.getElementById('pf-topup').style.display = 'block';
            selectTopupMethod('alif_mobi');
            loadTopupHistory();
        }
        // После пополнения — показываем кнопку "Продолжить"
        _showContinueBtn();
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
        currentProfileId = null;
        localStorage.removeItem('pendingCourseId');
        localStorage.removeItem('pendingProfileId');
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

// Polling уведомлений (review_comment + общие) для учителя — каждые 15 сек
var teacherNotifPollInterval = null;
function startTeacherNotifPoll() {
    if (teacherNotifPollInterval) clearInterval(teacherNotifPollInterval);
    var _lastUnread = -1;
    var _lastRevUnread = -1;
    teacherNotifPollInterval = setInterval(async function() {
        if (!currentUser || currentUser.role !== 'teacher') { clearInterval(teacherNotifPollInterval); return; }
        try {
            var notifs = await get('/users/notifications');
            var unread = notifs.filter(function(n){ return !n.is_read; }).length;
            var revUnread = notifs.filter(function(n){ return !n.is_read && n.type === 'review_comment'; }).length;

            // Обновляем бейдж уведомлений
            var nb = document.getElementById('td-notifs-cnt');
            if (nb) { nb.textContent = unread; nb.style.display = unread > 0 ? '' : 'none'; }

            // Обновляем бейдж отзывов
            var rb = document.getElementById('td-reviews-cnt');
            if (rb) { rb.textContent = revUnread; rb.style.display = revUnread > 0 ? '' : 'none'; }

            // Если открыт раздел Отзывы и появились новые — обновляем список
            if (revUnread !== _lastRevUnread && _lastRevUnread !== -1) {
                var revPanel = document.getElementById('tdp-t-reviews');
                if (revPanel && revPanel.classList.contains('on')) loadTeacherReviews();
            }
            // Если открыта панель уведомлений — обновляем
            if (unread !== _lastUnread && _lastUnread !== -1) {
                var notifPanel = document.getElementById('tdp-t-notifs');
                if (notifPanel && notifPanel.classList.contains('on')) loadTeacherNotifications();
            }
            _lastUnread = unread;
            _lastRevUnread = revUnread;
        } catch(e) {}
    }, 15000);
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
        var earnGross = document.getElementById('earn-gross');
        var earnComm  = document.getElementById('earn-comm');
        var earnNet   = document.getElementById('earn-net');
        if (earnGross) earnGross.textContent = parseFloat(stats.grossRevenue).toLocaleString('ru') + ' смн';
        if (earnComm)  earnComm.textContent  = parseFloat(stats.commission).toLocaleString('ru') + ' смн';
        if (earnNet)   earnNet.textContent   = parseFloat(stats.netRevenue).toLocaleString('ru') + ' смн';
        const previewEl = document.getElementById('td-courses-preview');
        if (previewEl) {
            if (courses.length > 0) {
                previewEl.innerHTML = courses.slice(0,3).map(function(c) {
                    return '<div class="d-cr-row" onclick="openTeacherCourse(\'' + c.id + '\')" style="cursor:pointer;border-radius:9px;transition:background .15s" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'\'">' +
                        '<div class="d-cr-ico">' + (c.emoji||'📖') + '</div>' +
                        '<div class="d-cr-inf">' +
                            '<div class="d-cr-t">' + c.title + '</div>' +
                            '<div class="d-cr-m">' + c.category + ' · ' + (c.student_count||0) + ' уч. · <span class="st-badge2 ' + (c.status==='active'?'st-on':'st-rev') + '">' + (c.status==='active'?'Активен':'На проверке') + '</span></div>' +
                        '</div>' +
                        '<div style="display:flex;align-items:center;gap:6px">' +
                            '<div class="d-cr-price">' + parseFloat(c.price).toLocaleString('ru') + ' смн</div>' +
                            '<div style="color:var(--text3);font-size:12px">→</div>' +
                        '</div>' +
                    '</div>';
                }).join('');
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
            // Reviews badge — непрочитанные review_comment
            const tRevUnread = tNotifs.filter(n => !n.is_read && n.type === 'review_comment').length;
            const tRevBadge = document.getElementById('td-reviews-cnt');
            if (tRevBadge) { tRevBadge.textContent = tRevUnread; tRevBadge.style.display = tRevUnread > 0 ? '' : 'none'; }
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
    startTeacherNotifPoll();

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
    if (panel === 't-reviews')  loadTeacherReviews();
    if (panel === 't-earnings') loadTeacherEarnings();
    setMobNav(panel, 'td');
}

async function loadTeacherCourses() {
    try {
        const courses = await get('/courses/my/list');
        const el = document.getElementById('td-all-courses');
        if (!courses.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">Курсов пока нет</div><button class="btn-lg green" onclick="tdShow(\'t-add-course\')">Добавить курс</button></div>'; return; }
        el.innerHTML = '<div class="d-card" style="padding:1.2rem">' + courses.map(function(c) {
            return '<div class="d-cr-row" onclick="openTeacherCourse(\'' + c.id + '\')" style="cursor:pointer;border-radius:9px;transition:background .15s" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'\'\'">' +
                '<div class="d-cr-ico">' + (c.emoji||'📖') + '</div>' +
                '<div class="d-cr-inf">' +
                    '<div class="d-cr-t">' + c.title + '</div>' +
                    '<div class="d-cr-m">' + c.category + ' · ' + (c.student_count||0) + ' уч. · ' +
                    '<span class="st-badge2 ' + (c.status==='active'?'st-on':'st-rev') + '">' + (c.status==='active'?'Активен':'На проверке') + '</span></div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:8px">' +
                    '<div class="d-cr-price">' + c.price + ' смн</div>' +
                    '<div style="font-size:12px;color:var(--text3)">→</div>' +
                '</div>' +
            '</div>';
        }).join('') + '</div>';
    } catch(e) { console.error(e); }
}


// Учитель открывает свой курс (видит всё как студент + инструменты учителя)

// ─── Загрузка материала учителем прямо из страницы курса ──────────
async function uploadCourseMaterial(input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    var statusEl = document.getElementById('cp-mat-upload-status');

    statusEl.style.display = 'block';
    statusEl.style.background = '#fef9c3';
    statusEl.style.color = '#854d0e';
    statusEl.textContent = '⏳ Загрузка: ' + file.name + '...';

    try {
        var fd = new FormData();
        fd.append('file', file);
        fd.append('courseId', currentCourseId);
        fd.append('title', file.name);

        var result = await upload('/teachers/materials/upload', fd);
        statusEl.style.background = '#dcfce7';
        statusEl.style.color = '#166534';
        statusEl.textContent = '✅ Файл загружен: ' + file.name;

        // Обновляем список материалов
        setTimeout(function() { loadCourseData(); }, 1000);
    } catch(e) {
        statusEl.style.background = '#fee2e2';
        statusEl.style.color = '#991b1b';
        statusEl.textContent = '❌ Ошибка: ' + (e.message || 'попробуйте снова');
    }
    input.value = '';
}

async function openTeacherCourse(courseId) {
    currentCourseId = courseId;
    go('course');
    await loadCourseData();
}

// ─── Редактор информации о курсе (для учителя) ────────────────────

// ─── Модал добавления урока ────────────────────────────────────────
function showAddLessonModal() {
    var modal = document.getElementById('add-lesson-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'add-lesson-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto';
        document.body.appendChild(modal);
    }
    modal.innerHTML =
        '<div style="background:var(--white);border-radius:20px;width:100%;max-width:540px;padding:1.5rem;box-shadow:0 24px 80px rgba(0,0,0,.2);max-height:90vh;overflow-y:auto;margin:auto">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">' +
                '<div style="font-size:16px;font-weight:800">📚 Новый урок</div>' +
                '<button onclick="document.getElementById(\'add-lesson-modal\').remove()" style="background:none;border:1.5px solid var(--border);border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px">✕</button>' +
            '</div>' +
            '<div style="margin-bottom:12px">' +
                '<label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:6px">Название урока *</label>' +
                '<input id="al-title" type="text" placeholder="Например: Введение в Python" style="width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;outline:none;box-sizing:border-box">' +
            '</div>' +
            '<div style="margin-bottom:12px">' +
                '<label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:6px">Описание урока</label>' +
                '<textarea id="al-content" rows="3" placeholder="Что студенты узнают на этом уроке..." style="width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;outline:none;box-sizing:border-box;resize:vertical"></textarea>' +
            '</div>' +
            '<div style="margin-bottom:16px">' +
                '<label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:8px">📎 Прикрепить файл к уроку (необязательно)</label>' +
                '<label id="al-file-label" style="display:flex;align-items:center;gap:10px;background:var(--bg);border:1.5px dashed var(--border);border-radius:10px;padding:14px;cursor:pointer">' +
                    '<span style="font-size:24px">📁</span>' +
                    '<div><div style="font-size:13px;font-weight:700">Выбрать файл</div>' +
                    '<div style="font-size:11px;color:var(--text3)">PDF, Word, картинки, видео — до 100 МБ</div></div>' +
                    '<input type="file" id="al-file" style="display:none" onchange="previewLessonFile(this)">' +
                '</label>' +
                '<div id="al-file-preview" style="display:none;margin-top:8px;padding:10px 12px;background:var(--gl2);border-radius:9px;font-size:13px;align-items:center;gap:8px">' +
                    '<span id="al-file-ico">📄</span>' +
                    '<span id="al-file-info" style="flex:1"></span>' +
                    '<button onclick="clearLessonFile()" style="background:none;border:none;color:#EF4444;cursor:pointer;font-size:16px">✕</button>' +
                '</div>' +
            '</div>' +
            '<div id="al-err" style="display:none;color:#EF4444;font-size:13px;margin-bottom:10px;padding:8px 12px;background:#fee2e2;border-radius:8px"></div>' +
            '<div id="al-progress" style="display:none;margin-bottom:10px">' +
                '<div style="height:6px;background:var(--border2);border-radius:3px;overflow:hidden"><div id="al-progress-bar" style="height:100%;background:var(--g);border-radius:3px;width:60%;transition:width .3s"></div></div>' +
                '<div style="font-size:12px;color:var(--text3);margin-top:4px;text-align:center">Загрузка файла...</div>' +
            '</div>' +
            '<button onclick="saveNewLesson()" class="btn-full green" id="al-save-btn">📚 Добавить урок</button>' +
        '</div>';
    modal.style.display = 'flex';
    setTimeout(function() { var t = document.getElementById('al-title'); if(t) t.focus(); }, 100);
}

function previewLessonFile(input) {
    var file = input.files[0];
    if (!file) return;
    var ext = file.name.split('.').pop().toLowerCase();
    var icons = {pdf:'📄',doc:'📝',docx:'📝',ppt:'📊',pptx:'📊',xls:'📈',xlsx:'📈',jpg:'🖼️',jpeg:'🖼️',png:'🖼️',gif:'🖼️',mp4:'🎬',mp3:'🎵',zip:'🗜️'};
    var size = file.size > 1024*1024 ? (file.size/1024/1024).toFixed(1)+' МБ' : (file.size/1024).toFixed(0)+' КБ';
    var label = document.getElementById('al-file-label');
    var preview = document.getElementById('al-file-preview');
    if (label) label.style.display = 'none';
    if (preview) {
        preview.style.display = 'flex';
        document.getElementById('al-file-ico').textContent = icons[ext] || '📎';
        document.getElementById('al-file-info').textContent = file.name + ' · ' + size;
    }
}

function clearLessonFile() {
    var input = document.getElementById('al-file');
    if (input) input.value = '';
    var label = document.getElementById('al-file-label');
    var preview = document.getElementById('al-file-preview');
    if (label) label.style.display = 'flex';
    if (preview) preview.style.display = 'none';
}


async function saveNewLesson() {
    var title    = document.getElementById('al-title').value.trim();
    var desc     = document.getElementById('al-content').value.trim();
    var fileInput = document.getElementById('al-file');
    var btn      = document.getElementById('al-save-btn');
    var err      = document.getElementById('al-err');
    var progress = document.getElementById('al-progress');

    err.style.display = 'none';
    if (!title) { err.textContent = 'Введите название урока'; err.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = '⏳ Создание урока...';
    try {
        // 1. Создаём урок
        var lessonResult = await post('/teachers/lessons', { courseId: currentCourseId, title, content: desc });

        // 2. Если выбран файл — загружаем отдельно (ошибка файла не отменяет урок)
        if (fileInput && fileInput.files && fileInput.files[0]) {
            btn.textContent = '⏳ Загрузка файла...';
            if (progress) progress.style.display = 'block';
            try {
                var fd = new FormData();
                fd.append('file', fileInput.files[0]);
                fd.append('courseId', currentCourseId);
                fd.append('lessonId', lessonResult.lessonId);
                fd.append('title', fileInput.files[0].name);
                await upload('/teachers/materials/upload', fd);
            } catch(fileErr) {
                // Урок создан, файл не загрузился — показываем предупреждение
                console.warn('File upload failed:', fileErr.message);
                showToast('Урок добавлен, но файл не загрузился: ' + (fileErr.message || ''), 'info');
            }
        }

        var modal = document.getElementById('add-lesson-modal');
        if (modal) modal.remove();
        showToast('✅ Урок добавлен!');
        await loadCourseData();
    } catch(e) {
        err.textContent = e.message || 'Ошибка сервера';
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = '📚 Добавить урок';
        if (progress) progress.style.display = 'none';
    }
}

// ─── Удалить урок ─────────────────────────────────────────────────

// ─── Материалы: переключение типа ────────────────────────────────
var _matType = 'file';
function setMatType(type) {
    _matType = type;
    ['file','link','photo'].forEach(function(t) {
        var btn = document.getElementById('mat-type-' + t);
        var field = document.getElementById('mat-field-' + t);
        if (btn) {
            btn.style.background = t === type ? 'var(--g)' : 'none';
            btn.style.color = t === type ? '#fff' : 'var(--text2)';
            btn.style.borderColor = t === type ? 'var(--g)' : 'var(--border)';
        }
        if (field) field.style.display = t === type ? '' : 'none';
    });
}

function previewMatFile(input) {
    var file = input.files[0];
    if (!file) return;
    var nameEl = document.getElementById('mat-fname');
    if (nameEl) nameEl.textContent = file.name;
    // Автозаполнение названия если пустое
    var titleEl = document.getElementById('mat-title');
    if (titleEl && !titleEl.value) titleEl.value = file.name.replace(/\.[^.]+$/, '');
}

function previewMatPhoto(input) {
    var file = input.files[0];
    if (!file) return;
    var nameEl = document.getElementById('mat-photo-name');
    if (nameEl) nameEl.textContent = file.name;
    var titleEl = document.getElementById('mat-title');
    if (titleEl && !titleEl.value) titleEl.value = file.name.replace(/\.[^.]+$/, '');
    var preview = document.getElementById('mat-photo-preview');
    var img = document.getElementById('mat-photo-img');
    if (preview && img) {
        preview.style.display = '';
        img.src = URL.createObjectURL(file);
    }
}

async function uploadCourseMaterialFull() {
    var title  = (document.getElementById('mat-title') || {}).value || '';
    var status = document.getElementById('cp-mat-upload-status');
    var btn    = document.getElementById('mat-submit-btn');

    if (!title.trim()) {
        if (status) { status.style.display='block'; status.style.background='#fee2e2'; status.style.color='#991b1b'; status.textContent='Введите название материала'; }
        return;
    }

    btn.disabled = true; btn.textContent = '⏳ Загрузка...';

    try {
        if (_matType === 'link') {
            // Ссылка — сохраняем через специальный эндпоинт
            var url = (document.getElementById('mat-url') || {}).value || '';
            if (!url) throw new Error('Введите ссылку');
            await post('/teachers/materials/link', { courseId: currentCourseId, title: title.trim(), url });
        } else {
            // Файл или фото
            var inputId = _matType === 'photo' ? 'cp-mat-photo-input' : 'cp-mat-file-input';
            var fileInput = document.getElementById(inputId);
            if (!fileInput || !fileInput.files || !fileInput.files[0]) throw new Error('Выберите файл');
            var fd = new FormData();
            fd.append('file', fileInput.files[0]);
            fd.append('courseId', currentCourseId);
            fd.append('title', title.trim());
            await upload('/teachers/materials/upload', fd);
        }

        if (status) { status.style.display='block'; status.style.background='#dcfce7'; status.style.color='#166534'; status.textContent='✅ Материал добавлен!'; }
        // Сброс формы
        document.getElementById('mat-title').value = '';
        var fi = document.getElementById('cp-mat-file-input'); if(fi) fi.value='';
        var pi = document.getElementById('cp-mat-photo-input'); if(pi) pi.value='';
        var mn = document.getElementById('mat-fname'); if(mn) mn.textContent='Выбрать файл';
        var pp = document.getElementById('mat-photo-preview'); if(pp) pp.style.display='none';
        var ui = document.getElementById('mat-url'); if(ui) ui.value='';
        setTimeout(function() { loadCourseData(); }, 800);
    } catch(e) {
        if (status) { status.style.display='block'; status.style.background='#fee2e2'; status.style.color='#991b1b'; status.textContent='❌ ' + (e.message||'Ошибка'); }
        btn.disabled = false; btn.textContent = '+ Добавить';
    }
}

async function deleteLesson(lessonId) {
    if (!confirm('Удалить этот урок? Действие нельзя отменить.')) return;
    try {
        await req('DELETE', '/teachers/lessons/' + lessonId);
        showToast('Урок удалён');
        await loadCourseData();
    } catch(e) { showToast(e.message || 'Ошибка', 'error'); }
}

// ─── Удалить материал ─────────────────────────────────────────────
async function deleteCourseMaterial(matId) {
    if (!confirm('Удалить этот материал?')) return;
    try {
        await req('DELETE', '/teachers/materials/' + matId);
        showToast('Материал удалён');
        await loadCourseData();
    } catch(e) { showToast(e.message || 'Ошибка', 'error'); }
}

async function showCourseEditModal(courseId) {
    try {
        var c = await get('/courses/' + courseId);
        var modal = document.getElementById('course-edit-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'course-edit-modal';
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem';
            document.body.appendChild(modal);
        }
        modal.innerHTML =
            '<div style="background:var(--white);border-radius:20px;width:100%;max-width:520px;padding:1.5rem;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.2)">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">' +
                    '<div style="font-size:16px;font-weight:800">✏️ Редактировать курс</div>' +
                    '<button onclick="var m=document.getElementById(\'course-edit-modal\');if(m)m.remove()" style="background:none;border:1.5px solid var(--border);border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px">✕</button>' +
                '</div>' +
                '<div class="field"><label>Название курса</label><input id="ce-title" type="text" value="' + (c.title||'') + '" style="width:100%;padding:11px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;outline:none;box-sizing:border-box"></div>' +
                '<div class="field"><label>Описание</label><textarea id="ce-desc" rows="4" style="width:100%;padding:11px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;outline:none;box-sizing:border-box;resize:vertical">' + (c.description||'') + '</textarea></div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
                    '<div class="field"><label>Цена (смн)</label><input id="ce-price" type="number" value="' + (c.price||0) + '" style="width:100%;padding:11px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;outline:none;box-sizing:border-box"></div>' +
                    '<div class="field"><label>Уровень</label><select id="ce-level" style="width:100%;padding:11px 14px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;outline:none;box-sizing:border-box">' +
                        ['Начинающий','Средний','Продвинутый'].map(function(l) {
                            return '<option' + (c.level===l?' selected':'') + '>' + l + '</option>';
                        }).join('') +
                    '</select></div>' +
                '</div>' +
                '<div id="ce-err" style="display:none;color:#EF4444;font-size:13px;margin-bottom:10px"></div>' +
                '<button onclick="saveCourseEdit(\'' + courseId + '\')" class="btn-full green" id="ce-save-btn">💾 Сохранить изменения</button>' +
                '<div style="font-size:12px;color:var(--text3);text-align:center;margin-top:8px">После изменений курс пройдёт повторную проверку</div>' +
            '</div>';
        modal.style.display = 'flex';
    } catch(e) { showToast('Ошибка загрузки курса', 'error'); }
}

async function saveCourseEdit(courseId) {
    var title = document.getElementById('ce-title').value.trim();
    var desc  = document.getElementById('ce-desc').value.trim();
    var price = document.getElementById('ce-price').value;
    var level = document.getElementById('ce-level').value;
    var btn   = document.getElementById('ce-save-btn');
    var err   = document.getElementById('ce-err');

    err.style.display = 'none';
    if (!title) { err.textContent = 'Введите название'; err.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = '⏳ Сохранение...';
    try {
        await put('/courses/' + courseId, { title, description: desc, price: parseFloat(price), level });
        document.getElementById('course-edit-modal').remove();
        showToast('✅ Курс обновлён! Отправлен на проверку.');
        loadTeacherCourses();
    } catch(e) {
        err.textContent = e.message || 'Ошибка';
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = '💾 Сохранить изменения';
    }
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

            return '<div class="chat-list-item" onclick="openChatWithStudent(\'' + c.id + '\', \'' + safeName + '\', \'' + initials + '\', \'' + safeColor + '\', \'' + (c.avatar_url||'') + '\')">' +
                '<div class="cli-av" style="background:' + safeColor + ';overflow:hidden">' +
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

// Student notifications polling — каждые 15 сек (review_comment и другие)
var studentNotifPollInterval = null;
function startStudentNotifPoll() {
    if (studentNotifPollInterval) clearInterval(studentNotifPollInterval);
    var _lastUnread = -1;
    studentNotifPollInterval = setInterval(async function() {
        if (!currentUser || currentUser.role !== 'student') { clearInterval(studentNotifPollInterval); return; }
        try {
            var notifs = await get('/users/notifications');
            var unread = notifs.filter(function(n){ return !n.is_read; }).length;
            // Обновляем бейдж
            var badge = document.getElementById('sb-notif-cnt');
            if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? '' : 'none'; }
            var dmBadge = document.getElementById('dm-notifs');
            if (dmBadge) dmBadge.textContent = unread;
            // Если открыта панель уведомлений — обновляем
            if (unread !== _lastUnread && _lastUnread !== -1) {
                var sdpNotif = document.getElementById('sdp-notifications');
                if (sdpNotif && sdpNotif.classList.contains('on')) loadNotifications();
            }
            _lastUnread = unread;
        } catch(e) {}
    }, 15000);
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
            return '<div class="chat-list-item" onclick="openChatWithStudent(\'' + c.id + '\', \'' + (c.first_name + ' ' + c.last_name).replace(/'/g,"\\'" ) + '\', \'' + initials + '\', \'' + (c.color||'#18A96A') + '\', \'' + (c.avatar_url||'') + '\')">' +
                '<div class="cli-av" style="background:' + (c.color||'#18A96A') + ';overflow:hidden">' +
                (c.avatar_url ? '<img src="' + c.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : (initials || '?')) +
                '</div>' +
                '<div class="cli-info">' +
                '<div class="cli-name">' + c.first_name + ' ' + c.last_name + '</div>' +
                '<div class="cli-last">' + shortMsg + '</div>' +
                '</div>' +
                (unreadNum > 0 ? '<span class="cli-badge">' + unreadNum + '</span>' : '') +
                '</div>';
        }).join('');
    } catch(e) { console.error('loadTeacherChats:', e); }
}

function openChatWithStudent(studentId, name, initials, color, avatarUrl) {
    chatTeacherId = studentId;
    var nameEl = document.getElementById('chat-name');
    var avEl   = document.getElementById('chat-av');
    if (nameEl) nameEl.textContent = name;
    if (avEl) {
        avEl.style.background = color;
        avEl.style.overflow = 'hidden';
        if (avatarUrl) {
            avEl.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
        } else {
            avEl.textContent = initials;
        }
    }
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
                         topup:'💳', welcome:'🎉', new_teacher:'👤', new_course:'📚', review_comment:'⭐' };

        el.innerHTML = sorted.map(function(n) {
            var ico     = ICONS[n.type] || '🔔';
            var time    = new Date(n.created_at).toLocaleDateString('ru', {day:'numeric', month:'short'});
            var unread  = !n.is_read;
            // Клик: review_comment → открыть раздел "Отзывы"
            var clickAttr = '';
            if (n.type === 'review_comment') {
                clickAttr = ' onclick="closeNotifPanel(); tdShow(\'t-reviews\');" style="cursor:pointer"';
            }
            return '<div class="notif-item' + (unread ? ' notif-unread' : '') + '"' + clickAttr + '>' +
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
        ? '<img src="' + t.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit">'
        : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:#fff;background:' + (t.color||'#18A96A') + '">' + (t.initials||'?') + '</div>';
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
            <div class="ccard-teacher"><div class="t-dot" style="background:${c.teacher?.color||'#18A96A'};overflow:hidden;padding:0">${c.teacher?.avatarUrl ? '<img src="'+c.teacher.avatarUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : (c.teacher?.initials||'?')}</div>${c.teacher?.firstName||''} ${c.teacher?.lastName||''}</div>
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

// Универсальная функция — возвращает innerHTML для аватарки
// person = { avatarUrl, initials, color }
function avHtml(person) {
    if (person && person.avatarUrl) {
        return '<img src="' + person.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit" loading="lazy">';
    }
    return person ? (person.initials || '?') : '?';
}

// Загрузка фото студента
async function uploadStudentPhoto(input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    if (file.size > 5 * 1024 * 1024) { showToast('Файл слишком большой. Максимум 5 МБ', 'error'); return; }

    // Сразу показываем preview
    var reader = new FileReader();
    reader.onload = function(e) {
        var avEl = document.getElementById('settings-av');
        if (avEl) {
            avEl.style.padding = '0';
            avEl.style.overflow = 'hidden';
            avEl.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
        }
    };
    reader.readAsDataURL(file);

    var fd = new FormData();
    fd.append('photo', file);
    try {
        showToast('⏳ Загружаем фото...');
        var result = await upload('/users/profile/photo', fd);
        currentUser.avatarUrl = result.avatarUrl;
        localStorage.setItem('user', JSON.stringify(currentUser));
        // Обновляем все аватарки
        setAvatar(document.getElementById('settings-av'), currentUser);
        setAvatar(document.getElementById('nav-av'), currentUser);
        setAvatar(document.getElementById('sd-av'), currentUser);
        // Если открыт профиль учителя — обновить отзывы чтобы показалось новое фото
        if (currentProfileId) {
            get('/teachers/' + currentProfileId).then(function(t) {
                var revEl = document.getElementById('pp-rev-list');
                if (revEl && revEl.closest('#page-profile')) {
                    renderRevList(t.reviews || [], 0);
                }
            }).catch(function(){});
        }
        showToast('✅ Фото обновлено!');
        input.value = '';
    } catch(e) { showToast('Ошибка загрузки: ' + (e.message||''), 'error'); }
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
    openChatWithStudent(s.id, s.firstName + ' ' + s.lastName, s.initials, s.color || '#18A96A', s.avatarUrl || null);
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



// ─── Отзывы учителя (дашборд) ────────────────────────
async function loadTeacherReviews() {
    var el = document.getElementById('td-reviews-list');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">⏳ Загрузка...</div>';
    try {
        // Загружаем отзывы и непрочитанные уведомления параллельно
        var [reviews, allNotifs] = await Promise.all([
            get('/teachers/my/reviews'),
            get('/users/notifications').catch(function(){ return []; })
        ]);
        // ID студентов которые написали новый комментарий (непрочитанные)
        var newCommentNotifs = allNotifs.filter(function(n){ return !n.is_read && n.type === 'review_comment'; });
        var hasNewComments = newCommentNotifs.length > 0;
        if (!reviews.length) {
            el.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text3)"><div style="font-size:2rem;margin-bottom:.5rem">⭐</div><div style="font-weight:700">Отзывов пока нет</div><div style="font-size:13px;margin-top:.4rem">Ученики оставят отзывы после занятий</div></div>';
            return;
        }

        // Баннер новых комментариев
        var newBanner = '';
        if (newCommentNotifs.length > 0) {
            newBanner = '<div style="display:flex;align-items:center;gap:.75rem;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid var(--g);border-radius:12px;padding:.875rem 1rem;margin-bottom:1rem">' +
                '<div style="font-size:22px">💬</div>' +
                '<div>' +
                    '<div style="font-size:13px;font-weight:800;color:var(--g2)">Новые ответы в обсуждениях (' + newCommentNotifs.length + ')</div>' +
                    '<div style="font-size:12px;color:var(--text2);margin-top:2px">Ученики ответили на ваши комментарии — посмотрите ниже</div>' +
                '</div>' +
            '</div>';
        }

        el.innerHTML = newBanner + '<div class="d-card" style="padding:1.2rem;display:flex;flex-direction:column;gap:1.2rem">' +
            reviews.map(function(r) {
                var stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
                var date = new Date(r.date).toLocaleDateString('ru', {day:'numeric', month:'long', year:'numeric'});
                // Подсвечиваем все карточки если есть новые комментарии (не знаем точно к какой)
                var cardHighlight = hasNewComments ? 'border-left:3px solid var(--g);padding-left:.75rem;' : '';
                return '<div style="padding-bottom:1.2rem;border-bottom:1px solid var(--border2);' + cardHighlight + '" id="rev-card-' + r.id + '">' +
                    '<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem">' +
                        '<div style="width:38px;height:38px;border-radius:50%;background:' + (r.student.color||'#18A96A') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px;flex-shrink:0;overflow:hidden">' + avHtml(r.student) + '</div>' +
                        '<div style="flex:1"><div style="font-size:13px;font-weight:700">' + r.student.name + '</div>' +
                        '<div style="font-size:11px;color:var(--text3)">' + date + (r.courseTitle ? ' · ' + r.courseTitle : '') + '</div></div>' +
                        '<div style="color:#f59e0b;font-size:16px">' + stars + '</div>' +
                    '</div>' +
                    '<div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:.75rem">' + (r.text||'') + '</div>' +
                    '<div class="rev-thread" id="rev-thread-' + r.id + '"><div style="font-size:12px;color:var(--text3)">⏳</div></div>' +
                    '<div class="rev-comment-form" style="margin-top:.6rem">' +
                        '<textarea class="rev-comment-ta" id="rev-ta-' + r.id + '" placeholder="Ответить ученику..." rows="2"></textarea>' +
                        '<button class="rev-comment-send" onclick="submitRevComment(\'' + r.id + '\')">Отправить</button>' +
                    '</div>' +
                '</div>';
            }).join('') + '</div>';
        reviews.forEach(function(r){ loadRevThread(r.id); });
    } catch(e) {
        console.error(e);
        el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">Ошибка загрузки</div>';
    }
}


// ─── Комментарии к отзывам (учитель ↔ ученик) ──────────────────────

async function loadRevThread(reviewId) {
    var el = document.getElementById('rev-thread-' + reviewId);
    if (!el) return;
    try {
        var comments = await get('/teachers/reviews/' + reviewId + '/comments');
        if (!comments.length) {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = '<div class="rev-thread-wrap">' +
            comments.map(function(c) {
                var isMe = currentUser && c.author && false; // just show all
                var isTeacherComment = c.role === 'teacher';
                var date = new Date(c.date).toLocaleDateString('ru', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
                var av = avHtml(c.author);
                return '<div class="rev-comment' + (isTeacherComment ? ' rev-comment--teacher' : '') + '" id="rev-cmt-' + c.id + '">' +
                    '<div class="rev-cmt-av" style="background:' + (c.author.color||'#18A96A') + '">' + av + '</div>' +
                    '<div class="rev-cmt-body">' +
                        '<div class="rev-cmt-meta">' +
                            '<span class="rev-cmt-name">' + c.author.name + '</span>' +
                            (isTeacherComment ? '<span class="rev-cmt-badge">Преподаватель</span>' : '') +
                            '<span class="rev-cmt-date">' + date + '</span>' +
                        '</div>' +
                        '<div class="rev-cmt-text">' + c.text + '</div>' +
                    '</div>' +
                '</div>';
            }).join('') +
        '</div>';
    } catch(e) { console.error('loadRevThread:', e); el.innerHTML = ''; }
}

async function submitRevComment(reviewId) {
    var ta = document.getElementById('rev-ta-' + reviewId);
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) { showToast('Напишите комментарий', 'info'); return; }
    try {
        await post('/teachers/reviews/' + reviewId + '/comments', { text: text });
        ta.value = '';
        await loadRevThread(reviewId);
        showToast('✅ Комментарий отправлен!');
    } catch(e) { showToast('Ошибка: ' + (e.message||''), 'error'); }
}

// ─── Ответ учителя на отзыв ───────────────────────────
var _replyingReviewId = null;

function openReplyModal(reviewId) {
    _replyingReviewId = reviewId;
    var existing = document.getElementById('reply-text-' + reviewId);
    document.getElementById('reply-modal-text').value = existing ? existing.textContent : '';
    document.getElementById('reply-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(function(){ document.getElementById('reply-modal-text').focus(); }, 100);
}

function closeReplyModal() {
    document.getElementById('reply-modal').style.display = 'none';
    document.body.style.overflow = '';
    _replyingReviewId = null;
}

async function submitReply() {
    var text = document.getElementById('reply-modal-text').value.trim();
    if (!text) { showToast('Напишите ответ', 'info'); return; }
    try {
        await put('/teachers/reviews/' + _replyingReviewId + '/reply', { reply: text });
        closeReplyModal();
        showToast('✅ Ответ опубликован!');
        // Обновляем оба возможных списка отзывов
        var tdPanel = document.getElementById('tdp-t-reviews');
        if (tdPanel && tdPanel.classList.contains('on')) {
            loadTeacherReviews();
        } else if (currentProfileId) {
            openProfile(currentProfileId);
        }
    } catch(e) { showToast('Ошибка: ' + (e.message||''), 'error'); }
}

// ═══════════════════════════════════════════════════════
// ОТЗЫВЫ
// ═══════════════════════════════════════════════════════
var selectedStars = 0;

function setStars(n) {
    selectedStars = n;
    document.querySelectorAll('.star-btn').forEach(function(s) {
        var v = parseInt(s.getAttribute('data-v'));
        s.style.opacity = v <= n ? '1' : '0.3';
        s.style.color   = v <= n ? '#F59E0B' : '';
    });
}

async function submitReview() {
    if (!selectedStars) { showToast('Поставьте оценку от 1 до 5 звёзд', 'info'); return; }
    var text = document.getElementById('pp-rev-text').value.trim();
    if (!text) { showToast('Напишите отзыв', 'info'); return; }
    if (!currentProfileId) return;

    var btn = event.target;
    btn.textContent = 'Отправка...';
    btn.disabled = true;

    try {
        // Ищем курс этого учителя (если есть запись)
        var courseId = null;
        try {
            var enrollments = await get('/payments/enrollments');
            var match = enrollments.find(function(e) {
                return e.teacherId === currentProfileId || e.teacher_id === currentProfileId;
            });
            if (match) courseId = match.courseId || match.course_id;
        } catch(e) {}

        await post('/users/reviews', {
            teacherId: currentProfileId,
            courseId:  courseId || null,
            stars:     selectedStars,
            text:      text,
        });

        selectedStars = 0;
        setStars(0);
        document.getElementById('pp-rev-text').value = '';
        document.getElementById('pp-rev-form').style.display = 'none';
        btn.textContent = 'Отправить отзыв';
        btn.disabled = false;

        showToast('✅ Спасибо за отзыв!');
        openProfile(currentProfileId);
    } catch(e) {
        showToast('Ошибка: ' + (e.message || ''), 'error');
        btn.textContent = 'Отправить отзыв';
        btn.disabled = false;
    }
}

function showReviewForm() {
    if (!currentUser) {
        var hint = document.getElementById('pp-rev-login-hint');
        var form = document.getElementById('pp-rev-form');
        if (hint) hint.style.display = 'block';
        if (form) form.style.display = 'none';
        return;
    }
    if (currentUser.role === 'student') {
        var form = document.getElementById('pp-rev-form');
        var hint = document.getElementById('pp-rev-login-hint');
        if (form) form.style.display = 'block';
        if (hint) hint.style.display = 'none';
    }
}


function openTeacherFromCourse() {
    if (!currentCourseData) return;
    var teacherId = currentCourseData.course.teacher.id;
    if (teacherId) {
        openProfile(teacherId);
    }
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
    if (avEl) {
        avEl.style.background = teacher.color;
        avEl.style.overflow = 'hidden';
        if (teacher.avatarUrl) {
            avEl.innerHTML = '<img src="' + teacher.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
        } else { avEl.textContent = teacher.initials; }
    }
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

    // Режим просмотра
    var isTeacherView = currentUser && currentUser.role === 'teacher';

    // Адаптируем UI под роль
    var chatBtn = document.getElementById('cp-chat-btn');
    if (chatBtn) chatBtn.style.display = isTeacherView ? 'none' : '';

    // Кнопка редактирования для учителя
    var editBtnEl = document.getElementById('cp-edit-btn');
    if (isTeacherView) {
        if (!editBtnEl) {
            var barRight = document.querySelector('#page-course .pp-bar-right');
            if (barRight) {
                var btn = document.createElement('button');
                btn.id = 'cp-edit-btn';
                btn.className = 'btn-sm solid';
                btn.textContent = '✏️ Редактировать';
                btn.onclick = function() { showCourseEditModal(currentCourseId); };
                barRight.appendChild(btn);
            }
        } else {
            editBtnEl.style.display = '';
        }
    } else {
        if (editBtnEl) editBtnEl.style.display = 'none';
    }

    // Для учителя — показываем только Уроки и Материалы
    var tabsWrap = document.querySelector('.cp-tabs');
    if (tabsWrap) {
        if (isTeacherView) {
            tabsWrap.innerHTML =
                '<button class=\"cp-tab on\" onclick=\"cpTab(\'lessons\', this)\"><span class=\"tab-full\">📚 Уроки</span><span class=\"tab-short\">📚</span></button>' +
                '<button class=\"cp-tab\" onclick=\"cpTab(\'materials\', this)\"><span class=\"tab-full\">📎 Материалы</span><span class=\"tab-short\">📎</span></button>';
        } else {
            tabsWrap.innerHTML =
                '<button class=\"cp-tab on\" onclick=\"cpTab(\'lessons\', this)\"><span class=\"tab-full\">📚 Уроки</span><span class=\"tab-short\">📚</span></button>' +
                '<button class=\"cp-tab\" onclick=\"cpTab(\'schedule\', this)\"><span class=\"tab-full\">📅 Расписание</span><span class=\"tab-short\">📅</span></button>' +
                '<button class=\"cp-tab\" onclick=\"cpTab(\'homework\', this)\"><span class=\"tab-full\">📝 Домашние задания</span><span class=\"tab-short\">📝</span></button>' +
                '<button class=\"cp-tab\" onclick=\"cpTab(\'materials\', this)\"><span class=\"tab-full\">📎 Материалы</span><span class=\"tab-short\">📎</span></button>';
        }
    }

    // Активная вкладка — уроки
    document.querySelectorAll('.cp-section').forEach(function(s) { s.style.display = 'none'; });
    var lessonsSection = document.getElementById('cps-lessons');
    if (lessonsSection) lessonsSection.style.display = '';

    // Для учителя — кнопка добавления урока
    if (isTeacherView && lessonsSection) {
        var oldAddBtn = document.getElementById('cp-add-lesson-btn');
        if (!oldAddBtn) {
            lessonsSection.insertAdjacentHTML('afterbegin',
                '<div id="cp-add-lesson-btn" style="margin-bottom:16px">' +
                    '<button onclick="showAddLessonModal()" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--gl2);border:2px dashed var(--g);border-radius:12px;padding:14px;font-size:14px;font-weight:700;color:var(--g2);cursor:pointer;transition:all .2s" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'var(--gl2)\'">' +
                        '<span style="font-size:20px">+</span> Добавить новый урок' +
                    '</button>' +
                '</div>'
            );
        }
    }

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
    var isT = currentUser && currentUser.role === 'teacher';
    el.innerHTML = lessons.map(function(l) {
        return '<div class="cp-lesson' + (l.isDone && !isT ? ' done' : '') + '" id="lesson-' + l.id + '">' +
            '<div class="cp-lesson-num">' + (l.isDone && !isT ? '✓' : l.order) + '</div>' +
            '<div class="cp-lesson-info">' +
                '<div class="cp-lesson-title">' + l.title + '</div>' +
                '<div class="cp-lesson-meta">' + (l.isDone && l.doneAt && !isT ? 'Пройдено ' + new Date(l.doneAt).toLocaleDateString('ru', {day:'numeric',month:'short'}) : 'Урок ' + l.order) + '</div>' +
            '</div>' +
            (isT
                ? '<button onclick="deleteLesson(\'' + l.id + '\')" style="background:none;border:none;color:#EF4444;font-size:18px;cursor:pointer;padding:4px 8px;border-radius:6px;opacity:.7" title="Удалить урок">🗑</button>'
                : '<div class="cp-lesson-check" onclick="toggleLesson(\'' + l.id + '\', ' + (!l.isDone) + ', event)" title="' + (l.isDone ? 'Отметить не пройденным' : 'Отметить пройденным') + '">' + (l.isDone ? '✓' : '') + '</div>'
            ) +
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
    // Кнопка загрузки для учителя
    var isT = currentUser && currentUser.role === 'teacher';
    var matsSection = document.getElementById('cps-materials');
    if (matsSection && isT) {
        var oldBtn = document.getElementById('cp-upload-mat-btn');
        if (!oldBtn) {
            matsSection.insertAdjacentHTML('afterbegin',
                '<div id="cp-upload-mat-btn" style="margin-bottom:16px">' +
                    '<div style="background:var(--white);border:1.5px solid var(--border);border-radius:14px;padding:16px">' +
                        '<div style="font-size:14px;font-weight:800;margin-bottom:12px;color:var(--text)">➕ Добавить материал</div>' +

                        // Тип материала
                        '<div style="display:flex;gap:8px;margin-bottom:14px">' +
                            '<button id="mat-type-file" onclick="setMatType(\'file\')" style="flex:1;padding:9px;border:1.5px solid var(--g);border-radius:9px;background:var(--g);color:#fff;font-size:12px;font-weight:700;cursor:pointer">📎 Файл</button>' +
                            '<button id="mat-type-link" onclick="setMatType(\'link\')" style="flex:1;padding:9px;border:1.5px solid var(--border);border-radius:9px;background:none;font-size:12px;font-weight:700;cursor:pointer;color:var(--text2)">🔗 Ссылка</button>' +
                            '<button id="mat-type-photo" onclick="setMatType(\'photo\')" style="flex:1;padding:9px;border:1.5px solid var(--border);border-radius:9px;background:none;font-size:12px;font-weight:700;cursor:pointer;color:var(--text2)">🖼️ Фото</button>' +
                        '</div>' +

                        // Название
                        '<input id="mat-title" type="text" placeholder="Название материала *" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:9px;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:10px">' +

                        // Файл
                        '<div id="mat-field-file">' +
                            '<label style="display:flex;align-items:center;gap:10px;background:var(--bg);border:1.5px dashed var(--border);border-radius:9px;padding:12px;cursor:pointer">' +
                                '<span style="font-size:22px">📁</span>' +
                                '<div><div style="font-size:13px;font-weight:700" id="mat-fname">Выбрать файл</div>' +
                                '<div style="font-size:11px;color:var(--text3)">PDF, Word, Excel, видео — до 100 МБ</div></div>' +
                                '<input type="file" id="cp-mat-file-input" style="display:none" onchange="previewMatFile(this)">' +
                            '</label>' +
                        '</div>' +

                        // Ссылка
                        '<div id="mat-field-link" style="display:none">' +
                            '<input id="mat-url" type="url" placeholder="https://..." style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:9px;font-size:13px;outline:none;box-sizing:border-box">' +
                        '</div>' +

                        // Фото
                        '<div id="mat-field-photo" style="display:none">' +
                            '<label style="display:flex;align-items:center;gap:10px;background:var(--bg);border:1.5px dashed var(--border);border-radius:9px;padding:12px;cursor:pointer">' +
                                '<span style="font-size:22px">🖼️</span>' +
                                '<div><div style="font-size:13px;font-weight:700" id="mat-photo-name">Выбрать фото</div>' +
                                '<div style="font-size:11px;color:var(--text3)">JPG, PNG, GIF</div></div>' +
                                '<input type="file" id="cp-mat-photo-input" accept="image/*" style="display:none" onchange="previewMatPhoto(this)">' +
                            '</label>' +
                            '<div id="mat-photo-preview" style="display:none;margin-top:8px"><img id="mat-photo-img" style="width:100%;border-radius:9px;max-height:200px;object-fit:cover"></div>' +
                        '</div>' +

                        '<div id="cp-mat-upload-status" style="display:none;margin-top:10px;padding:8px 12px;border-radius:9px;font-size:13px;text-align:center"></div>' +
                        '<button onclick="uploadCourseMaterialFull()" class="btn-full green" style="margin-top:12px;height:42px" id="mat-submit-btn">+ Добавить</button>' +
                    '</div>' +
                '</div>'
            );
        }
    }

    const el    = document.getElementById('cp-mat-list');
    const empty = document.getElementById('cp-mat-empty');
    if (!materials || !materials.length) {
        if (empty) empty.style.display = isT ? 'none' : '';
        if (el)    el.innerHTML = isT ? '<div style="text-align:center;padding:1rem;color:var(--text3);font-size:13px">Файлов пока нет — загрузите первый материал</div>' : '';
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
        var isTeach = currentUser && currentUser.role === 'teacher';
        var tag  = m.fileUrl ? 'a' : 'div';
        var href = m.fileUrl ? ' href="' + m.fileUrl + '" target="_blank"' : '';
        return '<div style="display:flex;align-items:center;gap:8px">' +
            '<' + tag + href + ' class="cp-mat-card" style="flex:1">' +
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
        '</' + tag + '>' +
            (isTeach ? '<button onclick="deleteCourseMaterial(\'' + m.id + '\')" style="background:none;border:none;color:#EF4444;font-size:18px;cursor:pointer;padding:8px;flex-shrink:0;opacity:.7" title="Удалить материал">🗑</button>' : '') +
        '</div>';
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


// ═══════════════════════════════════════════════════════
// СИСТЕМА ПОПОЛНЕНИЯ (СТУДЕНТ)
// ═══════════════════════════════════════════════════════
var _topupMethod = 'alif_mobi';

function selectTopupMethod(method) {
    _topupMethod = method;
    var alif = document.getElementById('method-alif');
    var card = document.getElementById('method-card');
    var alifD = document.getElementById('alif-details');
    var cardD = document.getElementById('card-details');
    if (!alif) return;
    if (method === 'alif_mobi') {
        alif.style.border = '2px solid var(--g)';
        card.style.border = '2px solid transparent';
        alifD.style.display = 'block';
        cardD.style.display = 'none';
    } else {
        card.style.border = '2px solid var(--g)';
        alif.style.border = '2px solid transparent';
        cardD.style.display = 'block';
        alifD.style.display = 'none';
    }
}

async function submitTopupRequest() {
    var amount = document.getElementById('tr-amount')?.value;
    var txid   = document.getElementById('tr-txid')?.value.trim();
    var comment = document.getElementById('tr-comment')?.value.trim();
    var errEl  = document.getElementById('tr-err');
    var btn    = document.getElementById('tr-submit-btn');

    errEl.style.display = 'none';
    if (!amount || parseFloat(amount) < 10) { errEl.textContent = 'Минимальная сумма 10 смн'; errEl.style.display = 'block'; return; }
    if (!txid) { errEl.textContent = 'Введите номер транзакции'; errEl.style.display = 'block'; return; }
    if (!_topupMethod) { errEl.textContent = 'Выберите способ оплаты'; errEl.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = '⏳ Отправка...';
    try {
        await post('/payments/topup-request', {
            amount: parseFloat(amount),
            method: _topupMethod,
            transaction_id: txid,
            comment,
            course_id: pendingCourseId || null
        });
        document.getElementById('tr-amount').value = '';
        document.getElementById('tr-txid').value = '';
        document.getElementById('tr-comment').value = '';

        // Показываем экран ожидания
        var payWrap = document.querySelector('.payment-wrap');
        if (payWrap) {
            payWrap.innerHTML =
                '<div style="text-align:center;padding:3rem 1rem">' +
                    '<div style="font-size:56px;margin-bottom:16px">⏳</div>' +
                    '<div style="font-size:18px;font-weight:800;margin-bottom:8px">Заявка отправлена!</div>' +
                    '<div style="font-size:14px;color:var(--text2);margin-bottom:24px;line-height:1.6">' +
                        'Администратор проверит перевод и одобрит.<br>' +
                        (pendingCourseId ? '<b>Курс будет куплен автоматически</b> после одобрения.' : 'Баланс пополнится в течение 15–30 минут.') +
                    '</div>' +
                    '<div style="background:var(--bg);border-radius:12px;padding:14px;font-size:13px;color:var(--text3)">' +
                        '🔄 Страница обновится автоматически...' +
                    '</div>' +
                '</div>';
        }

        // Polling — проверяем каждые 10 секунд одобрена ли заявка
        _startApprovalPolling();
    } catch(e) {
        errEl.textContent = e.message || 'Ошибка отправки';
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false; btn.textContent = '✅ Отправить заявку';
    }
}

async function loadTopupHistory() {
    var el = document.getElementById('tr-history');
    if (!el) return;
    try {
        var reqs = await get('/payments/topup-requests');
        if (!reqs.length) { el.innerHTML = ''; return; }
        var statusMap = { pending:'⏳ На проверке', approved:'✅ Зачислено', rejected:'❌ Отклонено' };
        var colorMap  = { pending:'#D97706', approved:'#16A34A', rejected:'#DC2626' };
        // Проверяем есть ли одобренные заявки — если да, показываем кнопку "Продолжить"
        var hasApproved = reqs.some(function(r) { return r.status === 'approved'; });
        var hasPending  = reqs.some(function(r) { return r.status === 'pending'; });

        el.innerHTML = '<div class="d-card"><div class="d-card-title">История заявок</div>' +
            reqs.map(function(r) {
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border2)">' +
                    '<div><div style="font-size:13px;font-weight:700">+' + parseFloat(r.amount).toLocaleString('ru') + ' смн</div>' +
                    '<div style="font-size:11px;color:var(--text3)">' + new Date(r.created_at).toLocaleDateString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) + '</div>' +
                    (r.admin_comment ? '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + r.admin_comment + '</div>' : '') +
                    '</div>' +
                    '<span style="font-size:12px;font-weight:700;color:' + colorMap[r.status] + '">' + statusMap[r.status] + '</span>' +
                '</div>';
            }).join('') + '</div>' +
            // Кнопка продолжить если есть одобренные
            (hasApproved ? '<button class="btn-full green" style="margin-top:12px" onclick="onBalanceApproved()">' +
                (pendingCourseId ? '🎓 Оплатить курс' : (currentProfileId ? '👨‍🏫 К профилю преподавателя' : '🔍 Перейти в каталог')) +
            '</button>' : '') +
            // Подсказка если есть ожидающие
            (hasPending && !hasApproved ? '<div style="text-align:center;font-size:12px;color:var(--text3);margin-top:10px">⏳ Ожидаем одобрения от администратора...</div>' : '');
    } catch(e) {}
}

// ═══════════════════════════════════════════════════════
// СИСТЕМА ВЫВОДА (УЧИТЕЛЬ)
// ═══════════════════════════════════════════════════════
var _wdMethod = 'alif_mobi';

function selectWdMethod(method) {
    _wdMethod = method;
    var alif = document.getElementById('wd-method-alif');
    var card = document.getElementById('wd-method-card');
    if (!alif) return;
    alif.style.borderColor = method === 'alif_mobi' ? 'var(--g)' : 'var(--border)';
    card.style.borderColor = method === 'card' ? 'var(--g)' : 'var(--border)';
}

async function loadTeacherEarnings() {
    // Баланс
    try {
        var data = await get('/payments/teacher/balance');
        var netEl = document.getElementById('earn-net');
        var wdEl  = document.getElementById('earn-withdrawn');
        var avEl  = document.getElementById('earn-available');
        if (netEl) netEl.textContent = parseFloat(data.totalEarned).toLocaleString('ru') + ' смн';
        if (wdEl)  wdEl.textContent  = parseFloat(data.totalWithdrawn).toLocaleString('ru') + ' смн';
        if (avEl)  avEl.textContent  = parseFloat(data.available).toLocaleString('ru') + ' смн';
    } catch(e) { console.error(e); }

    // История платежей от студентов
    try {
        var payments = await get('/teachers/my/payments');
        var listEl = document.getElementById('td-payments-list');
        if (!listEl) return;

        if (!payments.length) {
            listEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">Продаж пока нет</div>';
            return;
        }

        // Итоги сверху
        var totalGross = payments.reduce(function(s, p) { return s + p.pricePaid; }, 0);
        var totalComm  = payments.reduce(function(s, p) { return s + p.commission; }, 0);
        var totalNet   = payments.reduce(function(s, p) { return s + p.teacherAmount; }, 0);

        // Считаем только приходы для итогов
        var incomeItems     = payments.filter(function(p) { return p.type === 'income'; });
        var withdrawItems   = payments.filter(function(p) { return p.type === 'withdrawal'; });
        var totalGrossInc   = incomeItems.reduce(function(s, p) { return s + p.pricePaid; }, 0);
        var totalCommInc    = incomeItems.reduce(function(s, p) { return s + p.commission; }, 0);
        var totalNetInc     = incomeItems.reduce(function(s, p) { return s + p.amount; }, 0);
        var totalWithdrawn  = withdrawItems.reduce(function(s, p) { return s + p.amount; }, 0);

        listEl.innerHTML =
            // Итоговые карточки
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:16px">' +
                '<div style="background:var(--bg);border-radius:10px;padding:10px;text-align:center">' +
                    '<div style="font-size:10px;color:var(--text3);margin-bottom:3px">Студенты заплатили</div>' +
                    '<div style="font-size:15px;font-weight:800">' + totalGrossInc.toLocaleString('ru') + ' смн</div>' +
                '</div>' +
                '<div style="background:#fee2e2;border-radius:10px;padding:10px;text-align:center">' +
                    '<div style="font-size:10px;color:#991b1b;margin-bottom:3px">Комиссия платформы</div>' +
                    '<div style="font-size:15px;font-weight:800;color:#DC2626">−' + totalCommInc.toLocaleString('ru') + ' смн</div>' +
                '</div>' +
                '<div style="background:#d1fae5;border-radius:10px;padding:10px;text-align:center">' +
                    '<div style="font-size:10px;color:#065f46;margin-bottom:3px">Начислено вам</div>' +
                    '<div style="font-size:15px;font-weight:800;color:var(--g2)">+' + totalNetInc.toLocaleString('ru') + ' смн</div>' +
                '</div>' +
                '<div style="background:#ede9fe;border-radius:10px;padding:10px;text-align:center">' +
                    '<div style="font-size:10px;color:#5b21b6;margin-bottom:3px">Выведено</div>' +
                    '<div style="font-size:15px;font-weight:800;color:#7C3AED">−' + totalWithdrawn.toLocaleString('ru') + ' смн</div>' +
                '</div>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;gap:6px">' +
            payments.map(function(p) {
                var date = new Date(p.date).toLocaleDateString('ru', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
                if (p.type === 'income') {
                    var av = p.student.avatarUrl
                        ? '<img src="' + p.student.avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'
                        : (p.student.initials || '?');
                    return '<div style="display:flex;align-items:center;gap:10px;padding:11px 12px;background:var(--bg);border-radius:10px;border-left:3px solid var(--g)">' +
                        '<div style="width:36px;height:36px;border-radius:50%;background:' + (p.student.color||'#18A96A') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:800;flex-shrink:0;overflow:hidden">' + av + '</div>' +
                        '<div style="flex:1;min-width:0">' +
                            '<div style="font-size:13px;font-weight:700">' + p.student.name + '</div>' +
                            '<div style="font-size:11px;color:var(--text3)">' + p.courseEmoji + ' ' + p.courseTitle + ' · ' + date + '</div>' +
                        '</div>' +
                        '<div style="text-align:right;flex-shrink:0">' +
                            '<div style="font-size:14px;font-weight:800;color:var(--g2)">+' + p.amount.toLocaleString('ru') + ' смн</div>' +
                            '<div style="font-size:10px;color:var(--text3)">из ' + p.pricePaid.toLocaleString('ru') + ' · −' + p.commission.toLocaleString('ru') + ' комиссия</div>' +
                        '</div>' +
                    '</div>';
                } else {
                    return '<div style="display:flex;align-items:center;gap:10px;padding:11px 12px;background:var(--bg);border-radius:10px;border-left:3px solid #7C3AED">' +
                        '<div style="width:36px;height:36px;border-radius:50%;background:#ede9fe;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">💸</div>' +
                        '<div style="flex:1;min-width:0">' +
                            '<div style="font-size:13px;font-weight:700">Вывод средств</div>' +
                            '<div style="font-size:11px;color:var(--text3)">' + (p.method || '') + ' · ' + (p.cardOrPhone || '') + ' · ' + date + '</div>' +
                        '</div>' +
                        '<div style="font-size:14px;font-weight:800;color:#7C3AED;flex-shrink:0">−' + p.amount.toLocaleString('ru') + ' смн</div>' +
                    '</div>';
                }
            }).join('') +
            '</div>';
    } catch(e) { console.error(e); }
}

async function submitWithdraw() {
    var amount     = document.getElementById('wd-amount')?.value;
    var cardPhone  = document.getElementById('wd-card-phone')?.value.trim();
    var errEl      = document.getElementById('wd-err');
    var btn        = document.getElementById('wd-submit-btn');

    errEl.style.display = 'none';
    if (!amount || parseFloat(amount) < 50) { errEl.textContent = 'Минимальная сумма 50 смн'; errEl.style.display = 'block'; return; }
    if (!cardPhone) { errEl.textContent = 'Укажите номер карты или телефона'; errEl.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = '⏳ Отправка...';
    try {
        await post('/payments/teacher/withdraw', { amount: parseFloat(amount), method: _wdMethod, card_or_phone: cardPhone });
        showToast('✅ Заявка на вывод отправлена!');
        document.getElementById('wd-amount').value = '';
        document.getElementById('wd-card-phone').value = '';
        loadTeacherEarnings();
    } catch(e) {
        errEl.textContent = e.message || 'Ошибка';
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false; btn.textContent = 'Подать заявку на вывод';
    }
}


// ─── Polling: ждём одобрения заявки ───────────────────
var _approvalPollTimer = null;

function _startApprovalPolling() {
    if (_approvalPollTimer) clearInterval(_approvalPollTimer);
    _approvalPollTimer = setInterval(async function() {
        try {
            var reqs = await get('/payments/topup-requests');
            var latest = reqs[0]; // самая последняя заявка
            if (latest && latest.status === 'approved') {
                clearInterval(_approvalPollTimer);
                _approvalPollTimer = null;
                // Обновляем баланс
                var bal = await get('/payments/balance');
                currentUser.balance = bal.balance;
                localStorage.setItem('user', JSON.stringify(currentUser));
                showLoggedIn();
                // Очищаем pendingCourseId из localStorage
                localStorage.removeItem('pendingCourseId');
                localStorage.removeItem('pendingProfileId');
                pendingCourseId = null;
                currentProfileId = null;
                // Показываем успех и переходим в Мои курсы
                showToast('🎉 ' + (latest.admin_comment || 'Оплата прошла успешно!'));
                sdShow('my-courses');
                loadMyCourses();
            } else if (latest && latest.status === 'rejected') {
                clearInterval(_approvalPollTimer);
                _approvalPollTimer = null;
                showToast('❌ Заявка отклонена. ' + (latest.admin_comment || ''), 'error');
                sdShow('payment-flow');
                initPayFlow();
            }
        } catch(e) { /* тихо */ }
    }, 10000); // каждые 10 секунд
}

// ═══════════════════════════════════════════════════════
// СБРОС ПАРОЛЯ
// ═══════════════════════════════════════════════════════

var _resetToken = null;

async function submitForgotPassword() {
    var email = document.getElementById('forgot-email').value.trim();
    var btn   = document.getElementById('forgot-btn');
    var msg   = document.getElementById('forgot-msg');

    if (!email) { showForgotMsg('Введите email', 'error'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Отправка...';
    msg.style.display = 'none';

    try {
        await post('/auth/forgot-password', { email });
        showForgotMsg('✅ Письмо отправлено! Проверьте почту (и папку «Спам»).', 'success');
        btn.textContent = 'Отправить ещё раз';
    } catch(e) {
        showForgotMsg('Ошибка: ' + (e.message || 'попробуйте позже'), 'error');
        btn.textContent = 'Отправить ссылку';
    } finally {
        btn.disabled = false;
    }
}

function showForgotMsg(text, type) {
    var el = document.getElementById('forgot-msg');
    el.textContent = text;
    el.style.display = 'block';
    el.style.background = type === 'success' ? '#dcfce7' : '#fee2e2';
    el.style.color       = type === 'success' ? '#166534' : '#991b1b';
    el.style.border      = '1px solid ' + (type === 'success' ? '#86efac' : '#fca5a5');
}

async function openResetPage(token) {
    _resetToken = token;
    go('reset');
    // Проверяем валидность токена
    try {
        var result = await get('/auth/check-reset-token/' + token);
        if (!result.valid) {
            document.getElementById('reset-form').style.display = 'none';
            document.getElementById('reset-invalid').style.display = 'block';
        } else {
            document.getElementById('reset-form').style.display = 'block';
            document.getElementById('reset-invalid').style.display = 'none';
            document.getElementById('reset-success').style.display = 'none';
        }
    } catch(e) {
        document.getElementById('reset-form').style.display = 'none';
        document.getElementById('reset-invalid').style.display = 'block';
    }
}

async function submitResetPassword() {
    var pw  = document.getElementById('reset-pw').value;
    var pw2 = document.getElementById('reset-pw2').value;
    var err = document.getElementById('reset-err');
    var btn = document.getElementById('reset-btn');

    err.style.display = 'none';
    if (pw.length < 8) { err.textContent = 'Пароль минимум 8 символов'; err.style.display = 'block'; return; }
    if (pw !== pw2)    { err.textContent = 'Пароли не совпадают'; err.style.display = 'block'; return; }
    if (!_resetToken)  { err.textContent = 'Токен не найден'; err.style.display = 'block'; return; }

    btn.disabled = true;
    btn.textContent = '⏳ Сохранение...';

    try {
        await post('/auth/reset-password', { token: _resetToken, password: pw });
        document.getElementById('reset-form').style.display = 'none';
        document.getElementById('reset-success').style.display = 'block';
        _resetToken = null;
    } catch(e) {
        err.textContent = e.message || 'Ошибка. Попробуйте запросить новую ссылку.';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Сохранить пароль';
    }
}

init();
