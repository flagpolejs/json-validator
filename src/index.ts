export type Schema_Type =
  | "undefined"
  | "boolean"
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "null";

export type Schema = {
  type: Schema_Type | Schema_Type[];
  properties?: { [key: string]: Schema };
  items?: Schema;
  enum?: any[];
  pattern?: RegExp | string;
};

export class ValidationError {
  keyword?: string;
  instancePath: string;
  schemaPath?: string;
  params?: any;
  // Added to validation errors of propertyNames keyword schema
  propertyName?: string;
  // Excluded if messages set to false.
  message?: string;
  // These are added with the `verbose` option.
  schema?: any;
  parentSchema?: object;
  data?: any;
}

function getType(value: any): Schema_Type {
  // Handle null or undefined first
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  // Now look at the type
  const myType = typeof value;
  if (Array.isArray(value)) {
    return "array";
  }
  if (myType === "object") {
    return "object";
  }
  if (myType == "boolean") {
    return "boolean";
  }
  if (myType == "number") {
    return "number";
  }
  return "string";
}

/**
 * This isn't being used anymore, but maybe spin this off into separate repo because it's pretty good
 */
export default class JsonValidator {
  public static validate(schema: Schema | string, document: any) {
    const validator = new JsonValidator(schema);
    validator.validate(document);
    return validator;
  }

  protected _errors: ValidationError[] = [];
  protected _schema: Schema;

  public get isValid(): boolean {
    return this._errors.length === 0;
  }

  public get errors(): ValidationError[] {
    return this._errors;
  }

  public constructor(schema: Schema | string) {
    this.compile(schema);
  }

  public compile(schema: Schema | string) {
    this._schema = typeof schema === "string" ? JSON.parse(schema) : schema;
    return this.validate;
  }

  public validate(root: any): JsonValidator {
    this._errors = [];
    this._isValid(this._schema, root, "$");
    return this;
  }

  protected _logError(error: ValidationError) {
    this._errors.push(error);
  }

  protected _matchesType(schema: any, document: any, path: string): boolean {
    const [schemaType, docType] = this.compareTypes(schema, document);
    if (schemaType != "undefined") {
      // If schema item is a string, then it's defining type
      if (schemaType == "string") {
        if (docType != schema) {
          this._logError({
            keyword: "type",
            instancePath: path,
            message: `must be ${schemaType}, but it was ${docType}`,
          });
          return false;
        }
      }
      // If the type is an array, then it's an array of allowed types
      else if (schemaType == "array") {
        const allowedTypes: string[] = schema;
        if (allowedTypes.indexOf(docType) < 0) {
          const oneOfType = allowedTypes.join(" | ");
          this._logError({
            keyword: "type",
            instancePath: path,
            message: `must be ${oneOfType}, but it was ${docType}`,
          });
          return false;
        }
      }
    }
    return true;
  }

  protected _matchesEnum(schema: any, document: any, path: string): boolean {
    if (getType(schema) == "array") {
      // Value must be in this array
      if ((schema as any[]).indexOf(document) < 0) {
        const enumVals = schema.join(", ");
        this._logError({
          keyword: "value",
          instancePath: path,
          message: `value must be in enum ${enumVals}, but it was ${document}`,
        });
        return false;
      }
    }
    return true;
  }

  protected _matchesPattern(schema: any, document: any, path: string): boolean {
    const [schemaType] = this.compareTypes(schema, document);
    if (
      schemaType != "undefined" &&
      !new RegExp(schema).test(String(document))
    ) {
      this._logError({
        keyword: "value",
        instancePath: path,
        message: `value ${document} did not match  ${String(schema)}`,
      });
      return false;
    }
    return true;
  }

  protected _matchesItems(schema: any, document: any, path: string): boolean {
    const [schemaType, docType] = this.compareTypes(schema, document);
    if (schemaType != "undefined") {
      // If there is an items value then implicity this should be an array
      if (docType != "array") {
        this._logError({
          keyword: "schema",
          instancePath: path,
          message: `must be an array, but schema defines items.`,
        });
        return false;
      }
      // Loop through each item in the array
      return (document as Array<any>).every((subItem, index) => {
        // If it's a string, just validate the type of each item
        if (schemaType == "string" || schemaType == "array") {
          return this._matchesType(schema, subItem, `${path}[${index}]`);
        }
        // Otherwise, validate that array item against the "every" sub-schema
        else if (schemaType == "object") {
          return this._isValid(schema, subItem, `${path}[${index}]`);
        }
        return true;
      });
    }
    return true;
  }

  private compareTypes(schema: any, document: any) {
    return [getType(schema), getType(document)];
  }

  protected _matchesProperties(
    schema: any,
    document: any,
    path: string
  ): boolean {
    const [schemaType, docType] = this.compareTypes(schema, document);
    if (schemaType != "undefined") {
      // If there is an properties value then implicity this should be an object
      if (docType != "object") {
        this._logError({
          keyword: "schema",
          instancePath: "path",
          message: `must be an object, but schema defines properties.`,
        });
        return false;
      }
      // If properties is a string, then we are just expecting every property to be that type
      if (schemaType == "string" || schemaType == "array") {
        return Object.keys(document).every((key) => {
          return this._matchesType(schema, document[key], `${path}.${key}`);
        });
      }
      // If properties is an object, then test as a sub-schema
      if (schemaType == "object") {
        return Object.keys(schema).every((key) => {
          return this._isValid(schema[key], document[key], `${path}.${key}`);
        });
      }
    }
    return true;
  }

  protected _isValid(schema: any, document: any, path: string): boolean {
    const [schemaType] = this.compareTypes(schema, document);
    // If it's either a string or array, we're testing the type
    if (schemaType == "string" || schemaType == "array") {
      if (!this._matchesType(schema, document, path)) {
        return false;
      }
    }
    // If schema item is an object, then we do more complex parsing
    else if (schemaType == "object") {
      // type
      if (!this._matchesType(schema.type, document, path)) {
        if (!schema.optional || typeof document != "undefined") {
          return false;
        }
      }
      // enum
      if (!this._matchesEnum(schema.enum, document, path)) {
        return false;
      }
      // pattern
      if (!this._matchesPattern(schema.matches, document, path)) {
        return false;
      }
      // items
      if (!this._matchesItems(schema.items, document, path)) {
        return false;
      }
      // properties
      if (!this._matchesProperties(schema.properties, document, path)) {
        return false;
      }
    }
    // Fallback to true, probably invalid schema item
    return true;
  }
}
