import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../../db/client";
import { createAuthenticatedCaller, createCaller } from "../helpers/utils";
import resetDb from "../helpers/resetDb";
import { desc, eq } from "drizzle-orm";



describe("plans routes", async () => {
    beforeAll(async () => {
        await resetDb();
    });

    const adminUser = {
        email: "admin@example.com",
        password: "P@ssw0rd",
        name: "Admin User",
        timezone: "Asia/Riyadh",
        locale: "en",
    };

    const nonAdminUser = {
        email: "user@example.com",
        password: "P@ssw0rd",
        name: "Regular User",
        timezone: "Asia/Riyadh",
        locale: "en",
    };

    const CreatePlan = async (planData: { name: string; price: number, createdAt: Date, updatedAt: Date }) => {

        const [newPlan] = await db.insert(schema.plans).values(planData).returning();
        return newPlan;

    };

    const getOrCreateTeam = async (userId: number) => {
        const existingTeam = await db.query.teams.findFirst({
            where: eq(schema.teams.userId, userId),
        });
        if (existingTeam) {
            return existingTeam;
        } else {
            const [newTeam] = await db.insert(schema.teams).values({
                name: "Test Team",
                isPersonal: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                userId,
            }).returning();
            return newTeam;
        }
    };

    describe("create", async () => {


        it("should create a new plan when called by an admin user", async () => {
            await createCaller({}).auth.register(adminUser);
            await db
                .update(schema.users)
                .set({ emailVerified: true, isAdmin: true })
                .where(eq(schema.users.email, adminUser.email));
            const userInDb = await db.query.users.findFirst({
                where: eq(schema.users.email, adminUser.email),
            });
            await createCaller({ res: { setCookie: () => { } }, }).auth
                .login({ email: adminUser.email, password: adminUser.password });


            const planInput = { name: "Test Plan", price: 9.99 };

            // Call the create plan endpoint using trpc client
            const [createdPlan] = await createAuthenticatedCaller({
                userId: userInDb!.id,
            }).plans.create(planInput);

            // Check if the plan is created successfully
            expect(createdPlan).toHaveProperty("id");
            expect(createdPlan?.name).toBe(planInput.name);
            expect(createdPlan?.price).toBe(planInput.price);
            expect(createdPlan?.createdAt).toBeDefined();
            expect(createdPlan?.updatedAt).toBeDefined();
        });

        it("should throw an error when called by a non-admin user", async () => {

            await createCaller({}).auth.register(nonAdminUser);
            await db
                .update(schema.users)
                .set({ emailVerified: true })
                .where(eq(schema.users.email, nonAdminUser.email));
            const userInDb = await db.query.users.findFirst({
                where: eq(schema.users.email, nonAdminUser.email),
            });
            await createCaller({ res: { setCookie: () => { } }, }).auth
                .login({ email: nonAdminUser.email, password: nonAdminUser.password });

            const planInput = { name: "Test Plan", price: 9.99 };
            // Call the create route with the regular user
            try {

                await createAuthenticatedCaller({
                    userId: userInDb!.id,
                }).plans.create(planInput);

            } catch (error: any) {
                // Check if the error is 'FORBIDDEN'
                expect(error.code).toBe("FORBIDDEN");
                expect(error.message).toBe("Admin access required");
            }
        });
    });


    it("should update a plan's details when called by an admin user", async () => {

        const userInDb = await db.query.users.findFirst({
            where: eq(schema.users.email, adminUser.email),
        });
        await createCaller({ res: { setCookie: () => { } }, }).auth
            .login({ email: adminUser.email, password: adminUser.password });

        // Get or create plan
        const planInDb = await CreatePlan(
            {
                name: "Test Plan",
                price: 9.99,
                createdAt: new Date(),
                updatedAt: new Date()
            });

        // Update plan details
        const updateData = { name: "Updated Plan Name", price: 19.99 };

        // Update the plan using the API endpoint
        const updateResponse = await createAuthenticatedCaller({
            userId: userInDb!.id,
        }).plans.update({
            id: planInDb!.id,
            update: updateData,
        });


        // Check if the update was successful
        expect(updateResponse).toHaveProperty("success");
        expect(updateResponse.success).toBe(true);

        // Verify the plan was updated in the database
        const updatedPlan = await db.query.plans.findFirst({
            where: eq(schema.plans.id, planInDb!.id),
        });

        expect(updatedPlan).not.toBeNull();
        expect(updatedPlan?.name).toBe(updateData.name);
        expect(updatedPlan?.price).toBe(updateData.price);
    });


    it("should upgrade the plan", async () => {
        const userInDb = await db.query.users.findFirst({
            where: eq(schema.users.email, nonAdminUser.email),
        });
        await createCaller({ res: { setCookie: () => { } }, }).auth
            .login({ email: nonAdminUser.email, password: nonAdminUser.password });

        // Get or create a team for the user
        const team = await getOrCreateTeam(userInDb!.id);

        // Create an authenticated caller for the admin
        const adminCaller = createAuthenticatedCaller({ userId: userInDb!.id });

        // Get or create plans
        const currentPlan = await CreatePlan({
            name: "Basic Plan", price: 30, createdAt: new Date(),
            updatedAt: new Date(),
        });
        const newPlan = await CreatePlan({
            name: "Premium Plan", price: 60, createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Create subscription for the team
        const [subscription] = await db.insert(schema.subscriptions).values({
            teamId: team!.id,
            planId: currentPlan!.id,
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
        }).returning();

        // Create a dummy order for the subscription
        const [order] = await db.insert(schema.orders).values({
            subscriptionId: subscription!.id,
            amount: 10, // Assume initial amount
            currency: "SAR",
            status: "paid",
            createdAt: new Date(),
            updatedAt: new Date(),
        }).returning();

        // Create an activation record for the subscription
        await db.insert(schema.subscriptionActivations).values({
            subscriptionId: subscription!.id,
            startDate: new Date(new Date().setDate(new Date().getDate() - 20)), // 20 days ago
            endDate: new Date(new Date().setDate(new Date().getDate() + 10)), // 10 days remaining
            orderId: order!.id, // Dummy order ID
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Call the upgradePlan endpoint
        //const upgradeResponse = await adminCaller.plans.upgradePlan({ newPlanId: newPlan!.id });

        const upgradeResponse = await createAuthenticatedCaller({
            userId: userInDb!.id,
        }).plans.upgradePlan({ newPlanId: newPlan!.id });

        // Check if the upgrade was successful
        expect(upgradeResponse).toHaveProperty("success");
        expect(upgradeResponse.success).toBe(true);
        expect(upgradeResponse).toHaveProperty("proratedPrice");

        // Verify the subscription was updated in the database
        const updatedSubscription = await db.query.subscriptions.findFirst({
            where: eq(schema.subscriptions.id, subscription!.id),
        });

        expect(updatedSubscription).not.toBeNull();
        expect(updatedSubscription?.planId).toBe(newPlan!.id);

        // Verify the order was created in the database
        const createdOrder = await db.query.orders.findFirst({
            where: eq(schema.orders.subscriptionId, subscription!.id),
        });

        expect(createdOrder).not.toBeNull();
        expect(createdOrder?.amount).toBe(upgradeResponse.proratedPrice);

        // Verify the subscription activation was created in the database
        const activation = await db.query.subscriptionActivations.findFirst({
            where: eq(schema.subscriptionActivations.subscriptionId, subscription!.id),
            orderBy: desc(schema.subscriptionActivations.startDate),
        });

        expect(activation).not.toBeNull();

    });



});
