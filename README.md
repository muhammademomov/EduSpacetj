# EduSpace.tj 🎓

Первый маркетплейс онлайн-курсов Таджикистана.

---

## 📁 Структура проекта

```
eduspace_final/
├── frontend/
│   ├── index.html          ← HTML-разметка (все страницы SPA)
│   ├── css/
│   │   └── style.css       ← Все стили (переменные, компоненты, страницы)
│   └── js/
│       └── app.js          ← Вся логика (API клиент, роутер, UI)
│
├── backend/
│   ├── server.js           ← Express сервер (точка входа)
│   ├── package.json
│   ├── .env.example        ← Шаблон переменных окружения
│   ├── db/
│   │   ├── schema.sql      ← MySQL схема базы данных
│   │   ├── index.js        ← Пул соединений (поддержка Railway)
│   │   └── init.js         ← Инициализация БД + admin пользователь
│   ├── middleware/
│   │   └── auth.js         ← JWT аутентификация
│   └── routes/
│       ├── auth.js         ← Регистрация, вход, профиль
│       ├── teachers.js     ← Каталог преподавателей, профили
│       ├── courses.js      ← Курсы, уроки, отзывы
│       ├── payments.js     ← Баланс, пополнение, запись на курс
│       └── users.js        ← Избранное, уведомления, настройки, admin
│
├── railway.toml            ← Конфиг для Railway.app
├── nixpacks.toml           ← Конфиг сборки
└── .gitignore
```

---

## 🚀 Запуск локально

### 1. Установить зависимости
```bash
cd backend
npm install
```

### 2. Настроить переменные
```bash
cp .env.example .env
# Отредактируйте .env — укажите данные MySQL и JWT_SECRET
```

### 3. Создать базу данных
```bash
# Создайте БД в MySQL:
mysql -u root -p -e "CREATE DATABASE eduspace CHARACTER SET utf8mb4;"

# Инициализировать таблицы и admin пользователя:
node db/init.js
```

### 4. Запустить сервер
```bash
node server.js
# Сервер: http://localhost:3000
```

### 5. Открыть фронтенд
Откройте `frontend/index.html` в браузере или поднимите статический сервер:
```bash
cd ../frontend
npx serve .
```

---

## 🌐 Деплой на Railway.app (бесплатно)

### Шаг 1 — GitHub репозиторий
1. Создайте аккаунт на [github.com](https://github.com) (только email, без паспорта)
2. Создайте репозиторий `eduspace`
3. Загрузите все файлы проекта

### Шаг 2 — Railway
1. Зайдите на [railway.app](https://railway.app)
2. Войдите через GitHub
3. **New Project → Deploy from GitHub repo** → выберите `eduspace`
4. **+ New → Database → MySQL** (Railway автоматически настроит переменные)

### Шаг 3 — Переменные окружения
В разделе Variables добавьте:
```
JWT_SECRET=очень-длинная-случайная-строка-мин-32-символа
NODE_ENV=production
```

### Шаг 4 — Инициализация БД (один раз)
В Settings → Deploy → Start Command временно установите:
```
cd backend && node db/init.js && node server.js
```
После первого успешного деплоя верните:
```
cd backend && node server.js
```

### Шаг 5 — Обновить API URL во фронтенде
Railway выдаст URL вида: `https://eduspace-xxx.up.railway.app`

В `frontend/js/app.js` найдите строку:
```javascript
const API = 'http://localhost:3000/api';
```
Замените на:
```javascript
const API = 'https://eduspace-xxx.up.railway.app/api';
```
Загрузите изменения на GitHub — Railway обновится автоматически.

---

## 🔑 Доступы по умолчанию

| Роль | Email | Пароль |
|------|-------|--------|
| Admin | admin@eduspace.tj | admin123 |

---

## 📡 API эндпоинты

### Аутентификация
| Метод | URL | Описание |
|-------|-----|----------|
| POST | /api/auth/register | Регистрация (student/teacher) |
| POST | /api/auth/login | Вход → JWT токен |
| GET | /api/auth/me | Текущий пользователь |
| PUT | /api/auth/password | Смена пароля |

### Преподаватели
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /api/teachers | Каталог (search, sort, filter) |
| GET | /api/teachers/:id | Профиль + курсы + отзывы |
| PUT | /api/teachers/profile/update | Обновить профиль |
| POST | /api/teachers/photo | Загрузить фото |
| GET | /api/teachers/my/stats | Статистика преподавателя |
| GET | /api/teachers/my/students | Мои ученики |

### Курсы
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /api/courses | Все курсы (с фильтрами) |
| GET | /api/courses/:id | Курс + уроки |
| POST | /api/courses | Создать курс (→ модерация) |
| PUT | /api/courses/:id | Обновить курс |
| GET | /api/courses/my/list | Мои курсы |
| POST | /api/courses/:id/review | Оставить отзыв |

### Платежи
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /api/payments/balance | Баланс ученика |
| POST | /api/payments/topup | Пополнить баланс |
| POST | /api/payments/enroll | Записаться на курс (−15% комиссия) |
| GET | /api/payments/history | История транзакций |
| GET | /api/payments/enrollments | Мои записи на курсы |

### Пользователи / Admin
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /api/users/favorites | Избранные преподаватели |
| POST | /api/users/favorites | Добавить в избранное |
| GET | /api/users/notifications | Уведомления |
| PUT | /api/users/profile | Обновить профиль |
| POST | /api/users/admin/approve/:id | Одобрить преподавателя |
| POST | /api/users/admin/courses/:id/approve | Одобрить курс |
| GET | /api/users/admin/stats | Статистика платформы |

---

## 💰 Бизнес-модель

- Комиссия платформы: **15%** с каждой записи
- Преподаватель получает: **85%**
- Платежи симулируются (для реальной интеграции нужен банковский API)

---

## 🎨 Дизайн

- Основной цвет: `#18A96A` (зелёный)
- Шрифты: Plus Jakarta Sans + Instrument Serif
- SPA (Single Page Application) — без перезагрузки страницы
