import { IPricingModuleService } from "@medusajs/types"
import { ProductVariantService } from "../services"

import { AwilixContainer } from "awilix"
import { EntityManager } from "typeorm"
import { ProductVariant } from "../models"
import dotenv from "dotenv"
import express from "express"
import loaders from "../loaders"
import { createDefaultRuleTypes } from "./create-default-rule-types"

dotenv.config()

const BATCH_SIZE = 100

const migrateProductVariant = async (
  variant: ProductVariant,
  {
    container,
  }: { container: AwilixContainer; transactionManager: EntityManager }
) => {
  const pricingService: IPricingModuleService = container.resolve(
    "pricingModuleService"
  )

  const { link } = container.resolve("medusaApp")

  const priceSet = await pricingService.create({
    rules: [{ rule_attribute: "region_id" }],
    prices: variant.prices.map((price) => ({
      rules: {
        region_id: price.region_id,
      },
      currency_code: price.currency_code,
      min_quantity: price.min_quantity,
      max_quantity: price.max_quantity,
      amount: price.amount,
    })),
  })

  await link.create({
    productService: {
      variant_id: variant.id,
    },
    pricingService: {
      price_set_id: priceSet.id,
    },
  })
}

const processBatch = async (
  variants: ProductVariant[],
  container: AwilixContainer
) => {
  const manager = container.resolve("manager")
  return await manager.transaction(async (transactionManager) => {
    await Promise.all(
      variants.map(async (variant) => {
        await migrateProductVariant(variant, {
          container,
          transactionManager,
        })
      })
    )
  })
}

const migrate = async function ({ directory }) {
  const app = express()
  const { container } = await loaders({
    directory,
    expressApp: app,
    isTest: false,
  })

  const variantService: ProductVariantService = await container.resolve(
    "productVariantService"
  )

  await createDefaultRuleTypes(container)

  const [variants, totalCount] = await variantService.listAndCount(
    {},
    { take: BATCH_SIZE, order: { id: "ASC" }, relations: ["prices"] }
  )

  await processBatch(variants, container)

  let processedCount = variants.length
  console.log(`Processed ${processedCount} of ${totalCount}`)
  while (processedCount < totalCount) {
    const nextBatch = await variantService.list(
      {},
      {
        skip: processedCount,
        take: BATCH_SIZE,
        order: { id: "ASC" },
        relations: ["prices"],
      }
    )

    await processBatch(nextBatch, container)

    processedCount += nextBatch.length
    console.log(`Processed ${processedCount} of ${totalCount}`)
  }

  console.log("Done")
  process.exit(0)
}

migrate({ directory: process.cwd() })