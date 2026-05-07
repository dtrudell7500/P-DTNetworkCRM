# DT Network CRM

A personal networking CRM with GitHub sync, contact map, interaction timeline, and keep-in-touch reminders.

## Run locally

**Requirements:** Node.js 18+ ([nodejs.org](https://nodejs.org))

```bash
# 1. Install dependencies
npm install

# 2. Start dev server
npm run dev

# 3. Open http://localhost:5173 in your browser
```

## Deploy to GitHub Pages (free hosting)

1. Push this folder to a GitHub repo (can be the same repo as your contacts data, or a separate one)
2. Go to repo **Settings → Pages**
3. Under **Source**, select **GitHub Actions**
4. Push any change to the `main` branch — the site deploys automatically

Your app will be live at: `https://yourusername.github.io/your-repo-name`

## Connect to your contacts data

1. Open the app → click **⚙ Settings**
2. Enter your GitHub Personal Access Token (needs `repo` scope)
3. Enter the repo where your contacts are stored (e.g. `yourusername/my-network-crm`)
4. Click **Save & Connect**

The token is stored in your browser's localStorage — it never leaves your device.

## Features

- 👥 Contact management with photos (upload or URL)
- 📍 Location field + interactive contact map
- 📅 Keep-in-touch reminders with overdue tracking
- 📝 Interaction timeline (calls, meetings, emails, etc.)
- 🏷 Tags and filters
- 📞 One-tap call, text, email, LinkedIn
- ☁️ GitHub sync — works on PC, iPad, iPhone
