import { PrismaClient } from '@prisma/client';
import { WORKFLOW_TEMPLATES } from '../src/modules/workflows/workflow-templates';

const prisma = new PrismaClient();

/**
 * Seeds built-in workflow templates for every existing user (mirrors Laravel's
 * WorkflowTemplateSeeder). New users get them automatically at registration.
 */
async function main() {
  const users = await prisma.user.findMany({ select: { id: true } });
  let created = 0;

  for (const user of users) {
    for (const template of WORKFLOW_TEMPLATES) {
      const exists = await prisma.workflow.findFirst({
        where: { userId: user.id, sourceTemplate: template.slug },
        select: { id: true },
      });
      if (exists) {
        continue;
      }
      await prisma.workflow.create({
        data: {
          userId: user.id,
          name: template.name,
          description: template.description,
          status: 'draft',
          isActive: false,
          triggerType: template.trigger_type,
          sourceTemplate: template.slug,
          definition: template.definition as any,
        },
      });
      created++;
    }
  }

  console.log(`Seed complete. Created ${created} workflow(s) across ${users.length} user(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
