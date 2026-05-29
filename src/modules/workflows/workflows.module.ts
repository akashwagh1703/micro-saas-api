import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowValidator } from './workflow-validator.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { WorkflowExecutionService } from './workflow-execution.service';
import { TriggerNodeExecutor } from './nodes/trigger-node.executor';
import { ConditionNodeExecutor } from './nodes/condition-node.executor';
import { ApiNodeExecutor } from './nodes/api-node.executor';
import { AiNodeExecutor } from './nodes/ai-node.executor';
import { SendMessageNodeExecutor } from './nodes/send-message-node.executor';

@Module({
  imports: [IntegrationsModule],
  controllers: [WorkflowsController],
  providers: [
    WorkflowValidator,
    WorkflowTemplateService,
    WorkflowExecutionService,
    TriggerNodeExecutor,
    ConditionNodeExecutor,
    ApiNodeExecutor,
    AiNodeExecutor,
    SendMessageNodeExecutor,
  ],
  exports: [WorkflowValidator, WorkflowTemplateService, WorkflowExecutionService],
})
export class WorkflowsModule {}
