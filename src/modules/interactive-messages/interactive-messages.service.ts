import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateInteractiveTemplateDto,
  UpdateInteractiveTemplateDto,
  InteractiveMessageResponseDto,
  InteractiveTemplateListDto,
} from './dto/interactive-message.dto';

@Injectable()
export class InteractiveMessagesService {
  private readonly logger = new Logger(InteractiveMessagesService.name);

  constructor(private prisma: PrismaService) {}

  async createTemplate(
    userId: number,
    dto: CreateInteractiveTemplateDto,
  ): Promise<InteractiveMessageResponseDto> {
    this.logger.log(`Creating interactive template for user ${userId}`);

    // Validate message type and option limits
    const messageType = await this.prisma.interactiveMessageType.findUnique({
      where: { name: dto.messageType },
    });

    if (!messageType) {
      throw new BadRequestException(`Invalid message type: ${dto.messageType}`);
    }

    if (dto.options.length > messageType.maxOptions) {
      throw new BadRequestException(
        `${dto.messageType} can have maximum ${messageType.maxOptions} options`,
      );
    }

    // Create template with options
    const template = await this.prisma.interactiveMessageTemplate.create({
      data: {
        userId,
        name: dto.name,
        messageTypeId: messageType.id,
        headerText: dto.headerText,
        bodyText: dto.bodyText,
        footerText: dto.footerText,
        options: {
          create: dto.options.map((opt) => ({
            optionText: opt.optionText,
            description: opt.description,
            nextNodeId: opt.nextNodeId,
            displayOrder: opt.displayOrder,
            metadata: opt.metadata,
          })),
        },
      },
      include: {
        options: {
          orderBy: { displayOrder: 'asc' },
        },
        messageType: true,
      },
    });

    this.logger.log(`Created interactive template ${template.id} for user ${userId}`);

    return this.mapToResponseDto(template);
  }

  async getTemplateById(
    templateId: number,
    userId: number,
  ): Promise<InteractiveMessageResponseDto> {
    const template = await this.prisma.interactiveMessageTemplate.findFirst({
      where: { id: templateId, userId },
      include: {
        options: {
          orderBy: { displayOrder: 'asc' },
        },
        messageType: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Interactive template not found');
    }

    return this.mapToResponseDto(template);
  }

  async getUserTemplates(
    userId: number,
  ): Promise<InteractiveTemplateListDto[]> {
    const templates = await this.prisma.interactiveMessageTemplate.findMany({
      where: { userId },
      include: {
        messageType: true,
        _count: {
          select: { options: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      messageType: t.messageType.name,
      bodyText: t.bodyText,
      isActive: t.isActive,
      optionCount: t._count.options,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  async updateTemplate(
    templateId: number,
    userId: number,
    dto: UpdateInteractiveTemplateDto,
  ): Promise<InteractiveMessageResponseDto> {
    this.logger.log(`Updating interactive template ${templateId} for user ${userId}`);

    const template = await this.prisma.interactiveMessageTemplate.findFirst({
      where: { id: templateId, userId },
    });

    if (!template) {
      throw new NotFoundException('Interactive template not found');
    }

    // Validate option limits if options are being updated
    if (dto.options) {
      const messageType = await this.prisma.interactiveMessageType.findUnique({
        where: { id: template.messageTypeId },
      });

      if (!messageType) {
        throw new NotFoundException('Message type not found');
      }

      if (dto.options.length > messageType.maxOptions) {
        throw new BadRequestException(
          `${messageType.name} can have maximum ${messageType.maxOptions} options`,
        );
      }
    }

    // Update template
    const updatedTemplate = await this.prisma.interactiveMessageTemplate.update({
      where: { id: templateId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.headerText !== undefined && { headerText: dto.headerText }),
        ...(dto.bodyText !== undefined && { bodyText: dto.bodyText }),
        ...(dto.footerText !== undefined && { footerText: dto.footerText }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.options && {
          options: {
            deleteMany: {},
            create: dto.options.map((opt) => ({
              optionText: opt.optionText,
              description: opt.description,
              nextNodeId: opt.nextNodeId,
              displayOrder: opt.displayOrder,
              metadata: opt.metadata,
            })),
          },
        }),
      },
      include: {
        options: {
          orderBy: { displayOrder: 'asc' },
        },
        messageType: true,
      },
    });

    this.logger.log(`Updated interactive template ${templateId}`);

    return this.mapToResponseDto(updatedTemplate);
  }

  async deleteTemplate(templateId: number, userId: number): Promise<void> {
    this.logger.log(`Deleting interactive template ${templateId} for user ${userId}`);

    const template = await this.prisma.interactiveMessageTemplate.findFirst({
      where: { id: templateId, userId },
      include: {
        workflowNodes: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Interactive template not found');
    }

    // Check if template is being used in active workflows
    if (template.workflowNodes.length > 0) {
      throw new BadRequestException(
        'Cannot delete template that is being used in workflows',
      );
    }

    await this.prisma.interactiveMessageTemplate.delete({
      where: { id: templateId },
    });

    this.logger.log(`Deleted interactive template ${templateId}`);
  }

  async validateTemplate(templateId: number): Promise<{ valid: boolean; errors: string[] }> {
    const template = await this.prisma.interactiveMessageTemplate.findUnique({
      where: { id: templateId },
      include: {
        options: true,
        messageType: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Interactive template not found');
    }

    const errors: string[] = [];

    // Validate option count
    if (template.options.length === 0) {
      errors.push('Template must have at least one option');
    }

    if (template.options.length > template.messageType.maxOptions) {
      errors.push(
        `Template exceeds maximum option count of ${template.messageType.maxOptions}`,
      );
    }

    // Validate all options have valid next nodes if specified
    for (const option of template.options) {
      if (option.nextNodeId) {
        // Check if the node exists in the workflow
        // This would require workflow context, so we'll skip for now
        // In a real implementation, we'd validate against the workflow nodes
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async getOptionById(optionId: number) {
    return this.prisma.interactiveMessageOption.findUnique({
      where: { id: optionId },
      include: {
        template: {
          include: {
            messageType: true,
          },
        },
      },
    });
  }

  private mapToResponseDto(
    template: any,
  ): InteractiveMessageResponseDto {
    return {
      success: true,
      templateId: template.id,
      name: template.name,
      messageType: template.messageType.name,
      options: template.options.map((opt: any) => ({
        id: opt.id,
        optionText: opt.optionText,
        description: opt.description,
        nextNodeId: opt.nextNodeId,
      })),
      message: 'Interactive template created successfully',
    };
  }
}
