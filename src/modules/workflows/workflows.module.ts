import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SettingsModule } from '../settings/settings.module';
import { BillingModule } from '../billing/billing.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowValidator } from './workflow-validator.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { AiWorkflowGeneratorService } from './ai-workflow-generator.service';
import { WorkflowExecutionService } from './workflow-execution.service';
import { TriggerNodeExecutor } from './nodes/trigger-node.executor';
import { ConditionNodeExecutor } from './nodes/condition-node.executor';
import { ApiNodeExecutor } from './nodes/api-node.executor';
import { AiNodeExecutor } from './nodes/ai-node.executor';
import { SendMessageNodeExecutor } from './nodes/send-message-node.executor';
import { CollectInputNodeExecutor } from './nodes/collect-input-node.executor';

@Module({
  imports: [IntegrationsModule, SettingsModule, BillingModule],
  controllers: [WorkflowsController],
  providers: [
    WorkflowValidator,
    WorkflowTemplateService,
    AiWorkflowGeneratorService,
    WorkflowExecutionService,
    TriggerNodeExecutor,
    ConditionNodeExecutor,
    ApiNodeExecutor,
    AiNodeExecutor,
    SendMessageNodeExecutor,
    CollectInputNodeExecutor,
  ],
  exports: [WorkflowValidator, WorkflowTemplateService, WorkflowExecutionService],
})
export class WorkflowsModule {}
