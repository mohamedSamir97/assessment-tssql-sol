import { router, protectedProcedure, publicProcedure, trpcError } from "../../trpc/core";
import { z } from "zod";
import { schema, db } from "../../db/client";
import { desc, eq } from "drizzle-orm";


export const plans = router({

    create: protectedProcedure
        .input(z.object({ name: z.string(), price: z.number().positive() }))
        .mutation(async ({ ctx, input }) => {

            const user = await db.query.users.findFirst({
                where: (eq(schema.users.id, ctx.user.userId))
            });

            // Check if user is found and is an admin
            if (!user || !user.isAdmin) {
                throw new trpcError({ code: "FORBIDDEN", message: "Admin access required" });
            }

            // If user is an admin, proceed with plan creation
            const { name, price } = input;
            const createdPlan = await db
                .insert(schema.plans)
                .values({ name, price, createdAt: new Date(), updatedAt: new Date() })
                .returning();
            return createdPlan;
        }),
    update: protectedProcedure
        .input(
            z.object({
                id: z.number(),
                update: z.object({ name: z.string().optional(), price: z.number().positive().optional() }),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const user = await db.query.users.findFirst({
                where: (eq(schema.users.id, ctx.user.userId))
            });

            // Check if user is found and is an admin
            if (!user || !user.isAdmin) {
                throw new trpcError({ code: "FORBIDDEN", message: "Admin access required" });
            }

            const { id, update } = input;
            await db.update(schema.plans)
                .set(update)
                .where(eq(schema.plans.id, id))
                .returning();
            return { success: true };
        }),

    // Public procedure (Accessible to all users)
    get: publicProcedure.query(async () => {
        const plans = await db.select().from(schema.plans);
        return plans;
    }),

    upgradePlan: protectedProcedure
    .input(z.object({ newPlanId: z.number() }))
    .mutation(async ({ ctx, input }) => {
        const { newPlanId } = input;

        // Fetch the user's team
        const team = await db.query.teams.findFirst({
            where: eq(schema.teams.userId, ctx.user.userId)
        });

        if (!team) {
            throw new trpcError({ code: "BAD_REQUEST", message: "User does not belong to any team" });
        }

        // Fetch the current user's subscription
        const subscription = await db.query.subscriptions.findFirst({
            where: eq(schema.subscriptions.teamId, team.id)
        });

        if (!subscription) {
            throw new trpcError({ code: "BAD_REQUEST", message: "No active subscription found" });
        }

        // Fetch current and new plan details
        const currentPlan = await db.query.plans.findFirst({
            where: eq(schema.plans.id, subscription.planId)
        });

        const newPlan = await db.query.plans.findFirst({
            where: eq(schema.plans.id, newPlanId)
        });

        // Validate plans
        if (!currentPlan || !newPlan) {
            throw new trpcError({ code: "BAD_REQUEST", message: "Invalid plan ID" });
        }

        // Check if the new plan is an upgrade
        if (newPlan.price <= currentPlan.price) {
            throw new trpcError({
                code: "BAD_REQUEST",
                message: "New plan must have a higher price to be considered an upgrade"
            });
        }

        // Get the latest activation record for the subscription
        const latestActivation = await db.query.subscriptionActivations.findFirst({
            where: eq(schema.subscriptionActivations.subscriptionId, subscription.id),
            orderBy: desc(schema.subscriptionActivations.startDate),
        });

        if (!latestActivation) {
            throw new trpcError({ code: "BAD_REQUEST", message: "No activation record found" });
        }

        const today = new Date();
        //const cycleStartDate = new Date(latestActivation.startDate);
        const cycleEndDate = new Date(latestActivation.endDate);
        const remainingDays = Math.ceil((cycleEndDate.getTime() - today.getTime()) / (1000 * 3600 * 24));

        // Calculate prorated upgrade price
        const priceDifference = newPlan.price - currentPlan.price;
        const proratedPrice = Math.max(0, (priceDifference / 30) * remainingDays);

        // Create an order for the upgrade
        const [order] = await db.insert(schema.orders)
            .values({
                subscriptionId: subscription.id,
                amount: proratedPrice,
                currency: "SAR",
                status: "pending", //to be updated after success payment
                createdAt: new Date(),
                updatedAt: new Date()
            })
            .returning();

        // Update the subscription with the new plan
        await db.update(schema.subscriptions)
            .set({
                planId: newPlan.id,
                updatedAt: new Date()
            })
            .where(eq(schema.subscriptions.id, subscription.id))
            .returning();

        // Create a subscription activation record
        await db.insert(schema.subscriptionActivations)
            .values({
                subscriptionId: subscription.id,
                startDate: today,
                endDate: cycleEndDate,
                orderId: order!.id,
                createdAt: new Date(),
                updatedAt: new Date()
            })
            .returning();

        return {
            success: true,
            proratedPrice
        };
    }),

});
