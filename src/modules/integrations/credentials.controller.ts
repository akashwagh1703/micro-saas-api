import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CredentialVaultService } from './credential-vault.service';

class UpsertCredentialDto {
  @IsString()
  @MinLength(2)
  @MaxLength(63)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string;

  @IsString()
  @MinLength(1)
  secret: string;

  @IsOptional()
  @IsIn(['bearer', 'header', 'basic', 'api_key'])
  auth_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  header_name?: string;
}

@Controller('integrations/credentials')
@UseGuards(TokenAuthGuard)
export class CredentialsController {
  constructor(private readonly vault: CredentialVaultService) {}

  @Get()
  list(@CurrentUser('id') userId: number) {
    return this.vault.list(userId);
  }

  @Post()
  upsert(@CurrentUser('id') userId: number, @Body() dto: UpsertCredentialDto) {
    return this.vault.upsert(userId, dto);
  }

  @Delete(':name')
  async remove(@CurrentUser('id') userId: number, @Param('name') name: string) {
    await this.vault.remove(userId, name);
    return { message: 'Credential deleted' };
  }
}
