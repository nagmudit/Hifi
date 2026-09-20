---
status: current
last_verified: 2026-09-20
applies_to: [.env.example, apps/bot, apps/worker]
---

# Development credentials for M2

Everything needed to run HiFi end to end against the fixture repository, and how to get each piece. About twenty minutes, most of it clicking through three developer portals.

**Put every value straight into `.env`. Do not paste them into a chat with an agent.** Chat content leaves your machine and persists in transcripts. `.env` stays local and is gitignored. When it is filled in, say so, and the agent checks each variable is set without printing its value.

## What M2 needs

| Variable | From | Secret |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Discord developer portal, Bot tab | yes |
| `DISCORD_APPLICATION_ID` | Discord developer portal, General Information | no |
| `M2_DISCORD_GUILD_ID` | your test server, with developer mode on | no |
| `M2_DISCORD_CHANNEL_ID` | the channel the bot listens in | no |
| `GITHUB_APP_ID` | your GitHub App settings page | no |
| `GITHUB_APP_PRIVATE_KEY_PATH` | the `.pem` file GitHub downloads | the file is |
| `M2_GITHUB_INSTALLATION_ID` | the URL after installing the App | no |
| `M2_REPO_FULL_NAME` | already filled in: `nagmudit/hifi-fixture` | no |
| `M2_JOB_TOKEN_CEILING` | already filled in with a default; lower it to spend less per job | no |
| `M2_MODEL_PROVIDER` | `openai` | no |
| `M2_MODEL_API_KEY` | OpenAI platform, API keys | yes |
| `M2_MODEL_ID` | leave blank; chosen from what your key can reach | no |

The GitHub App's private key is the `.pem` file, and it is required. It signs the token request that mints a fresh installation token for every job. The variable holds a path rather than the key itself because a PEM is multi-line and awkward in a `.env` file; in production the key goes into `GITHUB_APP_PRIVATE_KEY` as a Fly secret instead.

**Not needed yet.** Each of these is in `.env.example` against the milestone that needs it.

| Variable | What it is actually for | Needed |
|---|---|---|
| `DISCORD_CLIENT_ID` | the same number as the Application ID. Discord calls it both names | M4, and it is already in the invite URL |
| `DISCORD_CLIENT_SECRET` | exchanging an OAuth code when a customer installs the bot from our dashboard | M4 |
| `DISCORD_PUBLIC_KEY` | verifying interaction webhooks, only if slash commands arrive over HTTP rather than the gateway | M3 at the earliest, possibly never |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | sign in with GitHub for the dashboard, `ADR-007`. Unrelated to repository access | M4 |
| `GITHUB_WEBHOOK_SECRET` | verifying deployment and pull request webhooks | M3 |
| `R2_*` | attachments and screenshots | M3 |
| `STRIPE_*` | subscriptions and metering | M5 |

The split on the GitHub side is worth remembering: **App ID plus private key** do the repository work, and **client ID plus secret** only identify a person signing in. M2 needs the first pair and nothing else.

## 1. Discord: a private test server and a development bot

**Create the server.**

1. In Discord, click the **+** in the server list, then **Create My Own**, then **For me and my friends**. Name it anything, for example `HiFi Dev`.
2. Create a text channel for the bot, for example `#hifi-test`.

**Create the application.**

3. Open <https://discord.com/developers/applications> and click **New Application**. Name it `HiFi Dev`.
4. On **General Information**, copy the **Application ID** into `DISCORD_APPLICATION_ID`.
5. Open the **Bot** tab.
   - Click **Reset Token** and copy the token into `DISCORD_BOT_TOKEN`. It is shown once. If you lose it, reset it again.
   - Turn **Public Bot** off, so nobody else can add your development bot to their server.
   - Under **Privileged Gateway Intents**, turn on **Message Content Intent**. Without it the bot receives mentions with empty text.
   - Save.

**If saving shows "Private application cannot have a default authorization link":** turning Public Bot off makes the application private, and a private application is not allowed to advertise a default install link. Open the **Installation** tab, set **Install Link** to **None**, save there, then return to the **Bot** tab and save again. The invite URL below still works, because a private application can still be added by the person who owns it, which is you.

**Invite the bot to your server.** Open this URL with your application ID in place of `APPLICATION_ID`:

```
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=309237763072
```

Pick your test server and authorise. The permission number grants exactly these, and nothing else:

| Permission | Why |
|---|---|
| View Channels | see the bound channel at all |
| Send Messages | reply |
| Embed Links | the final report is an embed |
| Attach Files | screenshots, from M3 |
| Read Message History | read the message that mentioned it |
| Create Public Threads | one thread per job |
| Send Messages in Threads | post and edit the status message |

**Copy the two IDs.**

6. In Discord, open **User Settings**, then **Advanced**, and turn on **Developer Mode**.
7. Right-click the server icon and choose **Copy Server ID**. That is `M2_DISCORD_GUILD_ID`.
8. Right-click `#hifi-test` and choose **Copy Channel ID**. That is `M2_DISCORD_CHANNEL_ID`.

## 2. GitHub: a development GitHub App on your personal account

HiFi never uses your personal token, not even in development. It uses a GitHub App, exactly as a customer would, so M2 tests the real path. `ADR-007` explains why an App rather than an OAuth token.

**Create the App.**

1. Go to <https://github.com/settings/apps> and click **New GitHub App**.
2. **GitHub App name:** must be unique across GitHub, for example `hifi-dev-nagmudit`.
3. **Homepage URL:** anything valid, for example `https://github.com/nagmudit/hifi-fixture`.
4. **Webhook:** untick **Active**. There is no public URL to receive events yet; M3 turns this on.
5. **Repository permissions,** and leave everything else at no access:
   - **Contents:** Read and write, to push the branch.
   - **Pull requests:** Read and write, to open the pull request.
   - **Metadata:** Read-only. GitHub sets this automatically.
6. **Where can this GitHub App be installed?** Choose **Only on this account**.
7. Click **Create GitHub App**.

**Collect its credentials.**

8. On the App's settings page, copy the **App ID** into `GITHUB_APP_ID`.
9. Scroll to **Private keys** and click **Generate a private key**. A `.pem` file downloads.
10. Move it **outside the repository**, for example to `C:\Users\mudit\.hifi\github-app.pem`, and set `GITHUB_APP_PRIVATE_KEY_PATH` to that path. Anyone with this file can act as the App.

**Install it on the fixture only.**

11. On the App's page, open **Install App** and click **Install** next to your account.
12. Choose **Only select repositories**, pick `hifi-fixture`, and install.
13. The browser lands on a URL ending in `/settings/installations/` followed by a number. That number is `M2_GITHUB_INSTALLATION_ID`.

The fixture's `main` branch is protected with one required review, and force pushes and deletions are blocked. The App therefore cannot push to `main` even if HiFi's own check failed, which is the second of the two layers `security-model.md` requires.

## 3. OpenAI: a development key with a hard ceiling

1. Sign in at <https://platform.openai.com> and open **API keys** in the settings.
2. Create a new secret key, scoped to a project you use only for HiFi development. Copy it into `M2_MODEL_API_KEY`.
3. **Put a hard ceiling on spend before using it.** HiFi's own spend cap does not exist until later milestones, so for now the only thing stopping a runaway agent loop is your provider account. Keep a small prepaid balance with automatic recharge turned off, or set a project budget. Check in the billing settings whether your budget is a hard stop or only an alert, since that has varied between account types.
4. Set `M2_MODEL_PROVIDER=openai` and leave `M2_MODEL_ID` blank.

The model is chosen after the key is in place, by listing the models your key can reach. That listing costs no tokens. For M2 it will be a small, cheap model, as agreed.

**Expect cheap models to fail sometimes.** A small model is often weak at multi-step tool use. If a job produces a poor change, that may be the model rather than the pipeline. The integration test with a stubbed engine exists to tell those two apart.

## 4. Check it

When `.env` is filled in, tell the agent. It verifies that each variable above is set and non-empty, confirms the `.pem` file exists at the path given, and never prints a value.

## If a credential leaks

| Credential | Revoke at |
|---|---|
| Discord bot token | developer portal, Bot tab, **Reset Token** |
| GitHub App private key | App settings, **Private keys**, delete the key |
| OpenAI key | platform settings, **API keys**, revoke |

Revoking any of these breaks nothing except the development setup, which is the point of using dedicated development credentials.
