import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CATALOG_MEDIA_KINDS,
  CATALOG_SECTION_TYPES,
  CATALOG_SLUG_MAX,
  CATALOG_SLUG_MIN,
  CATALOG_SLUG_REGEX,
} from '../catalog.constants';

export class CreateCatalogSiteDto {
  @IsString()
  @MinLength(CATALOG_SLUG_MIN)
  @MaxLength(CATALOG_SLUG_MAX)
  @Matches(CATALOG_SLUG_REGEX, {
    message: 'slug must be lowercase letters, numbers, and hyphens only',
  })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  business_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tagline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact_phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  contact_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact_whatsapp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;
}

export class UpdateCatalogSiteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  business_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tagline?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact_phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  contact_email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact_whatsapp?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown> | null;
}

export class UpdateCatalogSlugDto {
  @IsString()
  @MinLength(CATALOG_SLUG_MIN)
  @MaxLength(CATALOG_SLUG_MAX)
  @Matches(CATALOG_SLUG_REGEX, {
    message: 'slug must be lowercase letters, numbers, and hyphens only',
  })
  slug!: string;
}

export class UpdateCatalogSectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown> | null;
}

export class ReorderSectionItemDto {
  @IsInt()
  id!: number;

  @IsInt()
  @Min(0)
  sort_order!: number;
}

export class ReorderCatalogSectionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderSectionItemDto)
  sections!: ReorderSectionItemDto[];
}

export class CreateCatalogProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price_amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  price_currency?: string;

  @IsOptional()
  @IsInt()
  image_media_id?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateCatalogProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price_amount?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  price_currency?: string;

  @IsOptional()
  @IsInt()
  image_media_id?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateCatalogMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  alt?: string | null;

  @IsOptional()
  @IsInt()
  section_id?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @IsOptional()
  @IsIn([...CATALOG_MEDIA_KINDS])
  kind?: (typeof CATALOG_MEDIA_KINDS)[number];
}

/** Used only for OpenAPI/docs clarity; section type validation is in constants. */
export const CATALOG_SECTION_TYPE_VALUES = [...CATALOG_SECTION_TYPES];
