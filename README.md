# Uptime Wachter

## Overview
This project provides a flexible and efficient solution for monitoring the availability and performance of web services. It allows users to perform network tests from various global locations and receive instant notifications through Telegram utilizing [Globalping API](https://globalping.io/docs/api.globalping.io) and npm package [globalping-ts](https://www.npmjs.com/package/globalping-ts).

## Features
- **Global Monitoring**: Perform tests from multiple locations worldwide.
- **Flexible Configurations**: Customize your tests using a simple JSON format.
- **Instant Notifications**: Get real-time updates via Telegram for any issues detected.
- **Open Source**: Modify and extend the tool as needed.
- **Easy Setup**: Get started quickly without complex infrastructure.

## Requirements
- Node.js (version 18 or higher)
- Typescript
- pm2

## Configuration
- Create a bot using [BotFather](http://t.me/BotFather)
- Create ```.env``` file and set variables, telegram id you can find at [RawDataBot](http://t.me/RawDataBot)
- Create measurement: everything's according to API docs, except ```cronExpression``` field, you should add it to every measurement.

## Installation
1. Install dependencies: 
```sh
npm i
```

## Build

```sh
npm run build
```
## Run
```sh
pm2 start
```
or
```sh
npm run guard
```
