const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'EduSpace.tj <onboarding@resend.dev>';

async function sendEmail({ to, subject, html }) {
    if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY not set'); return; }
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_API_KEY },
            body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
        });
        const data = await res.json();
        if (!res.ok) console.error('Email error:', data);
        else console.log('Email sent to', to);
    } catch(e) { console.error('Email failed:', e.message); }
}

// Код подтверждения при регистрации
async function sendVerificationEmail({ email, firstName, code }) {
    await sendEmail({
        to: email,
        subject: '🔐 Код подтверждения — EduSpace.tj',
        html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px">
          <div style="text-align:center;margin-bottom:24px">
            <h1 style="color:#18A96A;margin:0">EduSpace.tj</h1>
            <p style="color:#666;margin:4px 0 0">Первый маркетплейс курсов Таджикистана</p>
          </div>
          <h2 style="margin:0 0 8px">Привет, ${firstName}! 👋</h2>
          <p style="color:#555;margin:0 0 24px">Для завершения регистрации введите этот код:</p>
          <div style="background:#fff;border:2px solid #18A96A;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px">
            <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#18A96A">${code}</div>
          </div>
          <p style="color:#999;font-size:13px;text-align:center;margin:0">
            ⏱ Код действителен <strong>10 минут</strong><br>
            Если вы не регистрировались — проигнорируйте это письмо.
          </p>
          <p style="color:#ccc;font-size:11px;text-align:center;margin:20px 0 0">EduSpace.tj · Душанбе, Таджикистан</p>
        </div>`
    });
}

// Приветственное письмо после подтверждения
async function sendWelcomeEmail(user) {
    await sendEmail({
        to: user.email,
        subject: '🎓 Добро пожаловать в EduSpace.tj!',
        html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <div style="text-align:center;margin-bottom:24px">
            <h1 style="color:#18A96A;margin:0">EduSpace.tj</h1>
            <p style="color:#666">Первый маркетплейс курсов Таджикистана</p>
          </div>
          <h2>Привет, ${user.firstName}! 👋</h2>
          <p>Вы успешно зарегистрировались на <strong>EduSpace.tj</strong>.</p>
          ${user.role === 'teacher' ? `
          <p>Ваш профиль отправлен на проверку. Как только мы одобрим его — вы появитесь в каталоге и сможете принимать учеников.</p>
          ` : `
          <p>Найдите своего преподавателя в каталоге и начните учиться уже сегодня!</p>
          `}
          <div style="text-align:center;margin:24px 0">
            <a href="https://eduspace.tj" style="background:#18A96A;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:700">Открыть EduSpace.tj →</a>
          </div>
          <p style="color:#999;font-size:12px;text-align:center">EduSpace.tj · Душанбе, Таджикистан · <a href="mailto:eduspacedushanbe@gmail.com">eduspacedushanbe@gmail.com</a></p>
        </div>`
    });
}

// Уведомление при одобрении баланса
async function sendTopupApprovedEmail(user, amount, courseTitle) {
    await sendEmail({
        to: user.email,
        subject: '✅ Баланс пополнен — EduSpace.tj',
        html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h1 style="color:#18A96A">EduSpace.tj</h1>
          <h2>Баланс пополнен! 💰</h2>
          <p>Привет, ${user.firstName}!</p>
          <p>На ваш счёт зачислено <strong style="color:#18A96A;font-size:18px">+${amount} смн</strong></p>
          ${courseTitle ? `<p>Курс <strong>"${courseTitle}"</strong> успешно оплачен!</p>` : ''}
          <div style="text-align:center;margin:24px 0">
            <a href="https://eduspace.tj/#student-dash" style="background:#18A96A;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:700">Перейти в кабинет →</a>
          </div>
          <p style="color:#999;font-size:12px;text-align:center">EduSpace.tj · Поддержка: @eduspacetj</p>
        </div>`
    });
}

// Уведомление учителю о новом ученике
async function sendNewStudentEmail(teacher, studentName, courseTitle, amount) {
    await sendEmail({
        to: teacher.email,
        subject: '🎉 Новый ученик — EduSpace.tj',
        html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h1 style="color:#18A96A">EduSpace.tj</h1>
          <h2>У вас новый ученик! 🎉</h2>
          <p>Привет, ${teacher.firstName}!</p>
          <p><strong>${studentName}</strong> записался на курс <strong>"${courseTitle}"</strong></p>
          <p>Вам начислено: <strong style="color:#18A96A;font-size:18px">+${amount} смн</strong></p>
          <div style="text-align:center;margin:24px 0">
            <a href="https://eduspace.tj/#teacher-dash" style="background:#18A96A;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:700">Открыть кабинет →</a>
          </div>
          <p style="color:#999;font-size:12px;text-align:center">EduSpace.tj · Поддержка: @eduspacetj</p>
        </div>`
    });
}

// Уведомление о новом домашнем задании
async function sendHomeworkEmail(student, teacherName, courseTitle, hwTitle) {
    await sendEmail({
        to: student.email,
        subject: '📝 Новое домашнее задание — EduSpace.tj',
        html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h1 style="color:#18A96A">EduSpace.tj</h1>
          <h2>Новое домашнее задание 📝</h2>
          <p>Привет, ${student.firstName}!</p>
          <p>Преподаватель <strong>${teacherName}</strong> добавил новое задание по курсу <strong>"${courseTitle}"</strong>:</p>
          <div style="background:#f5f5f5;padding:14px;border-radius:10px;margin:16px 0">
            <strong>${hwTitle}</strong>
          </div>
          <div style="text-align:center;margin:24px 0">
            <a href="https://eduspace.tj/#student-dash" style="background:#18A96A;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:700">Открыть задание →</a>
          </div>
          <p style="color:#999;font-size:12px;text-align:center">EduSpace.tj · Поддержка: @eduspacetj</p>
        </div>`
    });
}

module.exports = { sendVerificationEmail, sendWelcomeEmail, sendTopupApprovedEmail, sendNewStudentEmail, sendHomeworkEmail };
