import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateUserAccessDto {
  @IsOptional()
  @IsIn(['trial', 'active', 'cancelled', 'expired'])
  subscription_status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  extend_trial_days?: number;

  @IsOptional()
  grant_full_access?: boolean;
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  page?: string;
}
