import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../../db/client";
import { createAuthenticatedCaller, createCaller } from "../helpers/utils";
import resetDb from "../helpers/resetDb";
import { eq } from "drizzle-orm";

describe("orders routes", async () => {
    beforeAll(async () => {
        await resetDb();
    });

    describe("create", async () => {
        it("should create a new order when called with valid input", async () => {
            //creat user and login
            const testUser = {
                email: "user@example.com",
                password: "P@ssw0rd",
                name: "Test User",
                timezone: "Asia/Riyadh",
                locale: "en",
            };
            await createCaller({}).auth.register(testUser);
            await db
                .update(schema.users)
                .set({ emailVerified: true })
                .where(eq(schema.users.email, testUser.email));
            const userInDb = await db.query.users.findFirst({
                where: eq(schema.users.email, testUser.email),
            });
            await createCaller({ res: { setCookie: () => { } }, }).auth
                .login({ email: testUser.email, password: testUser.password });

                //Create team if not exists
            const existingTeam = await db.query.teams.findFirst({});
            let teamId;
            if (!existingTeam) {
                const [createdTeam] = await db
                    .insert(schema.teams)
                    .values({
                        name: "Test team", isPersonal: true, createdAt: new Date(),
                        updatedAt: new Date(),
                        userId: userInDb!.id
                    })
                    .returning();
                teamId = createdTeam!.id;

            } else {
                teamId = existingTeam.id;
            }

            // Create a plan if it doesn't exist
            const existingPlan = await db.query.plans.findFirst({});
            let planId;
            if (!existingPlan) {
                const [createdPlan] = await db
                    .insert(schema.plans)
                    .values({ name: "Test Plan", price: 9.99, createdAt: new Date(), updatedAt: new Date() })
                    .returning();
                planId = createdPlan!.id;
            } else {
                planId = existingPlan.id;
            }

            // Create a subscription if it doesn't exist
            const existingSubscription = await db.query.subscriptions.findFirst({});
            let subscriptionId;
            if (!existingSubscription) {
                const [createdSubscription] = await db
                    .insert(schema.subscriptions)
                    .values({ teamId: teamId, planId, status: "active", createdAt: new Date(), updatedAt: new Date() })
                    .returning();
                subscriptionId = createdSubscription!.id;
            } else {
                subscriptionId = existingSubscription.id;
            }

            // Create an order
            const orderInput = {
                subscriptionId,
                amount: 9.99,
                currency: "SAR",
                status: "pending",

            };
            const [createdOrder] = await createAuthenticatedCaller({
                userId: userInDb!.id,
            }).orders.create(orderInput);

            // Assert the created order
            expect(createdOrder).toHaveProperty("id");
            expect(createdOrder?.amount).toBe(orderInput.amount);
            expect(createdOrder?.currency).toBe(orderInput.currency);

        });
    });
});
