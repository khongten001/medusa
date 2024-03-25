import "core-js/stable"
import "regenerator-runtime/runtime"

import express from "express"
import { GracefulShutdownServer } from "medusa-core-utils"
import { track } from "medusa-telemetry"
import { scheduleJob } from "node-schedule"

import loaders from "../loaders"
import Logger from "../loaders/logger"

const EVERY_SIXTH_HOUR = "0 */6 * * *"
const CRON_SCHEDULE = EVERY_SIXTH_HOUR

export default async function ({ port, directory }) {
  async function start() {
    track("CLI_START")

    const app = express()

    try {
      const { dbConnection, configModule, container } = await loaders({
        directory,
        expressApp: app,
      })

      let server
      const serverActivity = Logger.activity(`Creating server`)
      server = GracefulShutdownServer.create(
        app.listen(port, (err) => {
          if (err) {
            return
          }
          Logger.success(serverActivity, `Server is ready on port: ${port}`)
          track("CLI_START_COMPLETED")
        })
      )

      try {
        const adminNext = require("@medusajs/admin-next")
        adminNext.default(app, server, configModule)
      } catch (_err) {
        // no-op `@medusajs/admin-next` is not installed
      }

      // Handle graceful shutdown
      const gracefulShutDown = () => {
        server
          .shutdown()
          .then(() => {
            Logger.info("Gracefully stopping the server.")
            process.exit(0)
          })
          .catch((e) => {
            Logger.error("Error received when shutting down the server.", e)
            process.exit(1)
          })
      }

      process.on("SIGTERM", gracefulShutDown)
      process.on("SIGINT", gracefulShutDown)

      scheduleJob(CRON_SCHEDULE, () => {
        track("PING")
      })

      return { dbConnection, server }
    } catch (err) {
      Logger.error("Error starting server", err)
      process.exit(1)
    }
  }

  await start()
}
