<p align="center">
<img src="./rustplusplus.png" width="500"></a>
</p>

<p align="center">
<a href="https://discord.gg/vcrKbKVAbc"><img src="https://img.shields.io/badge/Discord-Rust++-%237289DA?style=flat&logo=discord" alt="discord"/></a>
<a href="https://ko-fi.com/alexemanuelol"><img src="https://img.shields.io/badge/Donate%20a%20Coffee-alexemanuelol-yellow?style=flat&logo=buy-me-a-coffee" alt="donate on ko-fi"/></a>

<p align="center">
<a href="https://crowdin.com/project/rustplusplus"><img src="https://badges.crowdin.net/rustplusplus/localized.svg" alt="Crowdin"/></a>
</p>

<p align="center">
    <a href="https://discord.gg/vcrKbKVAbc">
        <img src="./join_discord.png" width="250">
    </a>
</p>

<h1 align="center"><em><b>rustplusplus</b> ~ Rust+ Discord Bot</em></h1>
</p>

A NodeJS Discord Bot that uses the [rustplus.js](https://github.com/liamcottle/rustplus.js) library to utilize the power of the [Rust+ Companion App](https://rust.facepunch.com/companion) with additional Quality-of-Life features.


## **How-to Setup Video**

[![Image of setup video](https://www.youtube.com/s/desktop/4a88d8c6/img/favicon_144x144.png)](https://youtu.be/GX03brJiMZg)

## **Features**

* Receive notifications for [In-Game Events](docs/discord_text_channels.md#events-channel) (Patrol Helicopter, Cargo Ship, Chinook 47, Oil Rigs triggered).
* Control [Smart Switches](docs/smart_devices.md#smart-switches) or Groups of Smart Switches via Discord or In-Game Team Chat.
* Setup [Smart Alarms](docs/smart_devices.md#smart-alarms) to notify in Discord or In-Game Team Chat whenever they are triggered.
* Use [Storage Monitors](docs/smart_devices.md#storage-monitors) to keep track of Tool Cupboard Upkeep or Large Wooden Box/Vending Machine content.
* Head over to the [Information Text Channel](docs/images/information_channel.png) to see all sorts of information about the server, ongoing events and team member status.
* Communicate with teammates from [Discord to In-Game](docs/discord_text_channels.md#teamchat-channel) and vice versa.
* Keep track of other teams on the server with the [Battlemetrics Player Tracker](docs/discord_text_channels.md#trackers-channel).
* Alot of [QoL Commands](docs/commands.md) that can be used In-Game or from Discord.
* View the [Full list of features](docs/full_list_features.md).


## **Documentation**

> Documentation can be found [here](https://github.com/faithix/rustplusplus/blob/master/docs/documentation.md). The documentation explains the features as well as `how to setup the bot`, so make sure to take a look at it 😉

## **Credentials**

> You can get your credentials by running the `rustplusplus credential application`. Download it [here](https://github.com/alexemanuelol/rustplusplus-credential-application/releases/download/v1.4.0/rustplusplus-1.4.0-win-x64.exe)


## **How to run the bot**

> To run the bot, simply open the terminal of your choice and run the following from repository root:

    $ npm start run


## **How to update the repository**

> Depending on your OS / choice of terminal you can run:

    $ update.bat

or

    $ ./update.sh


## **Running via docker**

    $ docker run --rm -it -v ${pwd}/credentials:/app/credentials -v ${pwd}/instances:/app/instances -v ${pwd}/logs:/app/logs -e RPP_DISCORD_CLIENT_ID=111....1111 -e RPP_DISCORD_TOKEN=token --name rpp ghcr.io/faithix/rustplusplus

or

    $ docker-compose up -d

Make sure you use the correct values for DISCORD_CLIENT_ID as well as DISCORD_TOKEN in the docker command/docker-compose.yml

Optional: set `RPP_BATTLEMETRICS_TOKEN` to use an authenticated BattleMetrics API token. If it is empty or unset, BattleMetrics requests stay anonymous as before.

## **Production storage**

When hosting RustAssist, keep these paths persistent across restarts and image updates:

* `instances/` - guild configuration, Discord channel/message ids, Rust server list, devices, trackers and cached license state.
* `credentials/` - Rust+ pairing credentials.
* `maps/` - generated map images.
* `data/` - runtime state such as timer/map marker state in `runtimeData.sqlite`.
* `database/` - player activity and history in `player_activity.db`.
* `logs/` - diagnostic logs.

`data/staticData.sqlite` is read-only application data. It only needs to exist in the deployed artifact/image; it does not need runtime backup or migration.

## **License and fleet configuration**

Production license/fleet mode uses these environment variables:

* `RPP_LICENSE_REQUIRED=true`
* `RPP_LICENSE_API_URL`
* `RPP_LICENSE_VALIDATION_GRACE_MS`
* `RPP_LICENSE_ACTIVATION_TIMEOUT_MS`
* `RPP_BOT_INSTANCE_ID`
* `RPP_BOT_INSTANCE_TOKEN`
* `RPP_BOT_INVITE_URL`
* `RPP_BOT_ACTIVE_GUILD_LIMIT`

`RPP_LICENSE_BYPASS=true` is for local development only.

This repository includes a minimal central API at `services/license-api`. It uses FastAPI, SQLAlchemy and SQLite by default. For the first bot, set `RPP_BOT_INSTANCE_ID` to the same value as `LICENSE_API_BOOTSTRAP_INSTANCE_ID`, and set `RPP_BOT_INSTANCE_TOKEN` to the same value as `LICENSE_API_BOOTSTRAP_INSTANCE_TOKEN`.

To create manual license keys, run the API and call `POST /admin/licenses` with `X-Admin-Token: <LICENSE_API_ADMIN_TOKEN>`. See `services/license-api/README.md` for examples.

## **Thanks to**

**liamcottle**@GitHub - for the [rustplus.js](https://github.com/liamcottle/rustplus.js) library.
<br>
**.Vegas.#4844**@Discord - for the awesome icons!
<br>
**alexemanuelol**@GitHub - for the Main Development of the [Rust++ Bot](https://github.com/alexemanuelol/rustPlusPlus).
