import {
  TransactionStepsDefinition,
  WorkflowManager,
} from "@medusajs/orchestration"
import { CartDTO, WorkflowTypes } from "@medusajs/types"
import {
  defaultStoreCartFields,
  defaultStoreCartRelations,
} from "@medusajs/utils"
import {
  CartHandlers,
  ShippingMethodHandlers,
  ShippingOptionHandlers,
} from "../../../handlers"
import { exportWorkflow, pipe } from "../../../helper"
import { Workflows } from "../../../definitions"
import { prepareAddShippingMethodToCartWorkflowData } from "./prepare-add-shipping-method-to-cart-data"
import { prepareDeleteShippingMethodsData } from "./prepare-delete-shipping-methods-data"
import { setRetrieveConfig } from "./set-retrieve-config"
import { compensateUpsertPaymentSessions } from "./compensate-upsert-payment-sessions"

export enum AddShippingMethodWorkflowActions {
  prepare = "prepare",
  validateFulfillmentData = "validateFulfillmentData",
  validateLineItemShipping = "validateLineItemShipping",
  getOptionPrice = "getOptionPrice",
  createShippingMethods = "createShippingMethods",
  cleanUpShippingMethods = "cleanUpShippingMethods",
  adjustFreeShipping = "adjustFreeShipping",
  upsertPaymentSessions = "upsertPaymentSessions",
  result = "result",
}

export const addShippingMethodWorkflowSteps: TransactionStepsDefinition = {
  next: [
    {
      action: AddShippingMethodWorkflowActions.validateFulfillmentData,
      noCompensation: true,
    },
    {
      action: AddShippingMethodWorkflowActions.getOptionPrice,
      noCompensation: true,
      next: {
        action: AddShippingMethodWorkflowActions.createShippingMethods,
        next: {
          action: AddShippingMethodWorkflowActions.validateLineItemShipping,
          noCompensation: true,
          saveResponse: false,
          next: {
            action: AddShippingMethodWorkflowActions.cleanUpShippingMethods,
            next: {
              action: AddShippingMethodWorkflowActions.adjustFreeShipping,
              saveResponse: false,
              next: {
                action: AddShippingMethodWorkflowActions.upsertPaymentSessions,
                saveResponse: false,
                next: {
                  action: AddShippingMethodWorkflowActions.result,
                  noCompensation: true,
                },
              },
            },
          },
        },
      },
    },
  ],
}

const handlers = new Map([
  [
    AddShippingMethodWorkflowActions.validateFulfillmentData,
    {
      invoke: pipe(
        {
          inputAlias: AddShippingMethodWorkflowActions.prepare,
          invoke: {
            from: AddShippingMethodWorkflowActions.prepare,
          },
          merge: true,
        },
        CartHandlers.validateShippingOptionForCart
      ),
    },
  ],
  [
    AddShippingMethodWorkflowActions.getOptionPrice,
    {
      invoke: pipe(
        {
          invoke: [
            {
              from: AddShippingMethodWorkflowActions.prepare,
            },
            {
              from: AddShippingMethodWorkflowActions.validateFulfillmentData,
              alias: "shippingMethodData",
            },
          ],
          merge: true,
        },
        ShippingOptionHandlers.getShippingOptionPrice
      ),
    },
  ],
  [
    AddShippingMethodWorkflowActions.createShippingMethods,
    {
      invoke: pipe(
        {
          invoke: [
            {
              from: AddShippingMethodWorkflowActions.prepare,
            },
            {
              from: AddShippingMethodWorkflowActions.validateFulfillmentData,
            },
            {
              from: AddShippingMethodWorkflowActions.getOptionPrice,
            },
          ],
          merge: true,
        },
        ShippingMethodHandlers.createShippingMethods
      ),
      compensate: pipe(
        {
          invoke: [
            {
              from: AddShippingMethodWorkflowActions.createShippingMethods,
              alias: "shippingMethodsToDelete",
            },
          ],
          merge: true,
        },
        async function ({ data }) {
          return {
            alias: "shippingMethodsToDelete",
            value: {
              shippingMethodsToDelete: data.shippingMethodsToDelete,
              softDelete: false,
            },
          }
        },
        ShippingMethodHandlers.deleteShippingMethods
      ),
    },
  ],
  [
    AddShippingMethodWorkflowActions.validateLineItemShipping,
    {
      invoke: pipe(
        {
          invoke: {
            from: AddShippingMethodWorkflowActions.prepare,
            alias: "input",
          },
          merge: true,
        },
        async function ({ data }) {
          return {
            alias: "cart",
            value: data.input.cart,
          }
        },
        setRetrieveConfig({
          relations: ["items", "items.variant", "items.variant.product"],
        }),
        CartHandlers.retrieveCart,
        CartHandlers.ensureCorrectLineItemShipping
      ),
    },
  ],
  [
    AddShippingMethodWorkflowActions.cleanUpShippingMethods,
    {
      invoke: pipe(
        {
          invoke: [
            {
              from: AddShippingMethodWorkflowActions.prepare,
              alias: "input",
            },
            {
              from: AddShippingMethodWorkflowActions.createShippingMethods,
              alias: "shippingMethods",
            },
          ],
          merge: true,
        },
        async function ({ data }) {
          return {
            alias: "cart",
            value: data.input.cart,
          }
        },
        prepareDeleteShippingMethodsData,
        ShippingMethodHandlers.deleteShippingMethods
      ),
      compensate: pipe(
        {
          invoke: [
            {
              from: AddShippingMethodWorkflowActions.prepare,
            },
            {
              from: AddShippingMethodWorkflowActions.cleanUpShippingMethods,
              alias: "deletedShippingMethods",
            },
          ],
          merge: true,
        },
        ShippingMethodHandlers.restoreShippingMethods
      ),
    },
  ],
  [
    AddShippingMethodWorkflowActions.adjustFreeShipping,
    {
      invoke: pipe(
        {
          invoke: {
            from: AddShippingMethodWorkflowActions.prepare,
            alias: "input",
          },
          merge: true,
        },
        setRetrieveConfig({
          relations: [
            "discounts",
            "discounts.rule",
            "shipping_methods.shipping_option",
          ],
        }),
        async function ({ data }) {
          return {
            alias: "cart",
            value: data.input.cart,
          }
        },
        CartHandlers.retrieveCart,
        CartHandlers.adjustFreeShippingOnCart
      ),
      compensate: pipe(
        {
          invoke: [
            {
              from: AddShippingMethodWorkflowActions.prepare,
            },
          ],
          merge: true,
        },
        CartHandlers.adjustFreeShippingOnCart
      ),
    },
  ],
  [
    AddShippingMethodWorkflowActions.upsertPaymentSessions,
    {
      invoke: pipe(
        {
          invoke: [
            {
              from: AddShippingMethodWorkflowActions.prepare,
            },
            {
              from: AddShippingMethodWorkflowActions.createShippingMethods,
              alias: "shippingMethods",
            },
          ],
          merge: true,
        },
        async function ({ data }) {
          return {
            alias: "cart",
            value: {
              ...data.cart,
              shipping_methods: data.shippingMethods,
            },
          }
        },
        CartHandlers.upsertPaymentSessions
      ),
      compensate: pipe(
        {
          invoke: {
            from: AddShippingMethodWorkflowActions.prepare,
            alias: "input",
          },
          merge: true,
        },
        async function ({ data }) {
          return {
            alias: "cart",
            value: data.input.cart,
          }
        },
        compensateUpsertPaymentSessions
      ),
    },
  ],
  [
    AddShippingMethodWorkflowActions.result,
    {
      invoke: pipe(
        {
          invoke: {
            from: AddShippingMethodWorkflowActions.prepare,
          },
          merge: true,
        },
        setRetrieveConfig({
          relations: defaultStoreCartRelations,
          select: defaultStoreCartFields,
        }),
        CartHandlers.retrieveCart
      ),
    },
  ],
])

WorkflowManager.register(
  Workflows.AddShippingMethod,
  addShippingMethodWorkflowSteps,
  handlers
)

export const addShippingMethod = exportWorkflow<
  WorkflowTypes.CartWorkflow.AddShippingMethodToCartWorkflowDTO,
  CartDTO
>(
  Workflows.AddShippingMethod,
  AddShippingMethodWorkflowActions.result,
  prepareAddShippingMethodToCartWorkflowData
)