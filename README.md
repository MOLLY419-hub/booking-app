# 公司內部訂房管理 MVP

這是第一版內部使用的訂房管理 Web App，使用 React、Supabase Auth、Supabase PostgreSQL 與 RLS 權限控管。前端可部署到 Vercel。

## 專案架構

```text
.
├── src
│   ├── components
│   │   ├── AppShell.tsx
│   │   ├── BookingForm.tsx
│   │   └── ProtectedRoute.tsx
│   ├── contexts
│   │   └── AuthContext.tsx
│   ├── lib
│   │   └── supabase.ts
│   ├── pages
│   │   ├── BookingListPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── LoginPage.tsx
│   │   └── NewBookingPage.tsx
│   ├── types
│   │   └── database.ts
│   ├── main.tsx
│   └── styles.css
├── supabase
│   └── schema.sql
├── .env.example
├── package.json
└── vite.config.ts
```

## Supabase 資料表設計

`profiles`

| 欄位 | 用途 |
| --- | --- |
| `id` | 對應 `auth.users.id` |
| `full_name` | 內部人員名稱 |
| `role` | `admin`、`staff`、`viewer` |
| `created_at` / `updated_at` | 建立與更新時間 |

`rooms`

| 欄位 | 用途 |
| --- | --- |
| `id` | 房間 ID |
| `name` | 房號或房名，例如 A101 |
| `room_type` | 房型 |
| `capacity` | 可入住人數 |
| `is_active` | 是否啟用 |

`bookings`

| 欄位 | 用途 |
| --- | --- |
| `room_id` | 對應房間 |
| `guest_name` / `guest_phone` | 住客資料 |
| `company_contact` | 公司內部窗口 |
| `check_in_date` / `check_out_date` | 入住與退房日期 |
| `status` | `pending`、`confirmed`、`checked_in`、`checked_out`、`cancelled` |
| `note` | 備註 |
| `created_by` / `updated_by` | 建立與更新人員 |

## 權限設定

| 角色 | 權限 |
| --- | --- |
| Admin | 可瀏覽、新增、修改、刪除訂房；可管理人員角色 |
| Staff | 可瀏覽、新增、修改訂房 |
| Viewer | 只能瀏覽訂房與今日總覽 |

RLS policies 已在 `supabase/schema.sql` 裡設定。新 Auth 使用者會自動建立 `profiles`，預設角色是 `viewer`。第一位管理員需由 Supabase SQL Editor 手動更新：

```sql
update public.profiles
set role = 'admin', full_name = 'Admin Name'
where id = '<auth-user-uuid>';
```

## 啟動方式

1. 在 Supabase 建立專案。
2. 到 SQL Editor 執行 `supabase/schema.sql`。
3. 建立 `.env.local`：

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

4. 安裝並啟動：

```bash
npm install
npm run dev
```

## Vercel 部署

在 Vercel 專案環境變數加入：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Build command 使用 `npm run build`，Output directory 使用 `dist`。
