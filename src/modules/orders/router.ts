import { router, protectedProcedure, publicProcedure, trpcError } from "../../trpc/core";
import { z } from "zod";
import { db, schema } from "../../db/client";
import { eq } from "drizzle-orm";

export const orders = router({
  // Create order endpoint
  create: protectedProcedure
    .input(
      z.object({
        subscriptionId: z.number(),
        amount: z.number().positive(),
        currency: z.string(),
        status: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user is authenticated (optional, depends on your system)
      if (!ctx.user) {
        throw new trpcError({
          code: "UNAUTHORIZED",
          message: "User authentication required",
        });
      }

      // Validate subscriptionId (optional, depends on your system)
      const subscription = await db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.id, input.subscriptionId),
      });
      if (!subscription) {
        throw new trpcError({
          code: "BAD_REQUEST",
          message: "Invalid subscription ID",
        });
      }

      // Create the order
      const order = await db.insert(schema.orders).values({
        subscriptionId: input.subscriptionId,
        amount: input.amount,
        currency: input.currency,
        status: "pending", // Default status
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      return order;
    }),

  // Retrieve order by ID endpoint
  getById: protectedProcedure
    .input(z.number())
    .query(async ({ ctx, input }) => {
      // Check if user is authenticated (optional, depends on your system)
      if (!ctx.user) {
        throw new trpcError({
          code: "UNAUTHORIZED",
          message: "User authentication required",
        });
      }

      // Retrieve order by ID
      const order = await db.query.orders.findFirst({
        where: eq(schema.orders.id, input),
      });
      if (!order) {
        throw new trpcError({
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      return order;
    }),

  // Update order status endpoint
  updateStatus: protectedProcedure
    .input(
      z.object({
        orderId: z.number(),
        status: z.string().regex(/^(pending|paid|failed|canceled)$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user is authenticated (optional, depends on your system)
      if (!ctx.user) {
        throw new trpcError({
          code: "UNAUTHORIZED",
          message: "User authentication required",
        });
      }

      // Update order status
      const updatedOrder = await db.update(schema.orders)
        .set({ status: input.status })
        .where(eq(schema.orders.id, input.orderId))
        .returning();

      if (!updatedOrder) {
        throw new trpcError({
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      return updatedOrder;
    }),
});
