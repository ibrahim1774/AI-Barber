<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1EvVwYgPrz6pdCiVDm8rrZeNnWI2aMlbq

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key

3. Run the app:
   ```bash
   npm run dev
   ```

## Automatic Deployment Feature

This app now includes **automatic GitHub repository creation and Vercel deployment** for generated barbershop websites!

### How It Works

When a user generates a website and clicks the **"DEPLOY"** button:

1. ✅ Creates a new GitHub repository with the generated website files
2. ✅ Pushes all static HTML/CSS to the repository
3. ✅ Automatically deploys to Vercel
4. ✅ Returns live deployment URL and GitHub repository link

### Setup Deployment (Required for Deploy Feature)

To enable the deployment functionality, you need to configure GitHub and Vercel API tokens:

#### 1. Create a GitHub Personal Access Token

1. Go to [GitHub Settings → Tokens](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Give it a name (e.g., "Barber AI Deployment")
4. Select the following scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `workflow` (Update GitHub Action workflows)
5. Click **"Generate token"** and copy the token

#### 2. Create a Vercel API Token

1. Go to [Vercel Account Settings → Tokens](https://vercel.com/account/tokens)
2. Click **"Create Token"**
3. Give it a name (e.g., "Barber AI Deployment")
4. Select the appropriate scope (Full Account recommended)
5. Click **"Create"** and copy the token

#### 3. Configure Environment Variables

Create a `.env` file in the root directory (or add to your existing `.env.local`):

```env
GITHUB_TOKEN=your_github_personal_access_token_here
VERCEL_TOKEN=your_vercel_api_token_here
```

**Important:** Never commit the `.env` file to version control. Use `.env.example` as a template.

### Usage

1. Generate a barbershop website using the dashboard
2. Click the **"DEPLOY"** button in the top navigation
3. Wait for deployment to complete (usually 30-60 seconds)
4. Receive:
   - GitHub repository URL
   - Live Vercel deployment URL
5. Share the live site with your customer!

### Features

- 🚀 One-click deployment
- 📦 Automatic GitHub repository creation
- 🌐 Instant Vercel hosting
- 🔗 Shareable live URLs
- 📱 Fully responsive generated sites
- ✨ Production-ready HTML/CSS
