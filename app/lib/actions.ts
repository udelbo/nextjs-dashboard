'use server';
 
import { z } from 'zod';
import { sql} from '@vercel/postgres';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { AuthError } from 'next-auth';

import { NextResponse } from "next/server";
import path from "path";
import { writeFile } from "fs/promises";
import fs from 'fs';

function sanitizeAndTimestampFilename(originalFilename: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
  const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}_${milliseconds}`;

  const extension = path.extname(originalFilename);
  let nameWithoutExtension = path.basename(originalFilename, extension);

  nameWithoutExtension = nameWithoutExtension.replace(/[^a-zA-Z0-9-_]/g, '_');

  return `${nameWithoutExtension}_${timestamp}${extension}`;
}

const FormSchema = z.object({
    id: z.string(),
    customerId: z.string({
      invalid_type_error: 'Please select a customer.',
    }),
    amount: z.coerce
      .number()
      .gt(0, { message: 'Please enter an amount greater than $0.' }),
    status: z.enum(['pending', 'paid'], {
      invalid_type_error: 'Please select an invoice status.',
    }),
    date: z.string(),
});

const FormSchemaCustomer = z.object({
  id: z.string(),
  name: z.string({
    required_error: "Ingrese el nombre del cliente",
    invalid_type_error: "Caracteres no válidos",
  }),
  email: z.string().email({ message: "Email no válido" }),
  image_url: z.string(),
  image_upload: z
  .custom<FileList>()
  .transform((val) => {
    if (val instanceof File) return val;
    if (val instanceof FileList) return val[0];
    return null;
  })
  .superRefine((file, ctx) => {
    if (!(file instanceof File)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        fatal: true,
        message: 'Not a file',
      });

      return z.NEVER;
    }

    if (file.size > 5 * 1024 * 1024) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Max file size allowed is 5MB',
      });
    }

    if (
      !['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(
        file.type
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'File must be an image (jpeg, jpg, png, webp)',
      });
    }
  })
  .pipe(z.custom<File>()),
});
 
const CreateInvoice = FormSchema.omit({ id: true, date: true });
const UpdateInvoice = FormSchema.omit({ id: true, date: true });

const CreateCustomer = FormSchemaCustomer.omit({ id: true});
const UpdateCustomer = FormSchemaCustomer.omit({ id: true});

export type State = {
  errors?: {
    customerId?: string[];
    amount?: string[];
    status?: string[];
  };
  message?: string | null;
};

export type StateCustomer = {
  errors?: {
    name?: string[];
    email?: string[];
    image_url?: string[];
    image_upload?: any[];
  };
  message?: string | null;
};
  
export async function createInvoice(prevState: State, formData: FormData) {
  // Validate form using Zod
  const validatedFields = CreateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });
  
  // If form validation fails, return errors early. Otherwise, continue.
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Invoice.',
    };
  }
  
  // Prepare data for insertion into the database
  const { customerId, amount, status } = validatedFields.data;
  const amountInCents = amount * 100;
  const date = new Date().toISOString().split('T')[0];
  
  // Insert data into the database
  try {
    await sql`
      INSERT INTO invoices (customer_id, amount, status, date)
      VALUES (${customerId}, ${amountInCents}, ${status}, ${date})
    `;
  } catch (error) {
    // If a database error occurs, return a more specific error.
    return {
      message: 'Database Error: Failed to Create Invoice.',
    };
  }
  
  // Revalidate the cache for the invoices page and redirect the user.
  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function updateInvoice(
  id: string,
  prevState: State,
  formData: FormData,
) {
  const validatedFields = UpdateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });
  
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Update Invoice.',
    };
  }
  
  const { customerId, amount, status } = validatedFields.data;
  const amountInCents = amount * 100;
  
  try {
    await sql`
      UPDATE invoices
      SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
      WHERE id = ${id}
    `;
  } catch (error) {
    return { message: 'Database Error: Failed to Update Invoice.' };
  }
  
  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function deleteInvoice(id: string) {
    await sql`DELETE FROM invoices WHERE id = ${id}`;
    revalidatePath('/dashboard/invoices');
}

export async function createCustomer(prevState: StateCustomer, formData: FormData) {
  // Validate form using Zod
  const validatedFields = CreateCustomer.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    image_url: formData.get('image_url'),
  });

  // If form validation fails, return errors early. Otherwise, continue.
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Invoice.',
    };
  }
  
  // Prepare data for insertion into the database
  const { name, email, image_url } = validatedFields.data;
  
  // Insert data into the database
  try {
    await sql`
      INSERT INTO customers (name, email, image_url)
      VALUES (${name}, ${email}, ${image_url})
    `;
  } catch (error) {
    // If a database error occurs, return a more specific error.
    return {
      message: 'Database Error: Failed to Create Customer.',
    };
  }
  
  // Revalidate the cache for the invoices page and redirect the user.
  revalidatePath('/dashboard/customers');
  redirect('/dashboard/customers');
}

export async function updateCustomer(
  id: string,
  prevState: StateCustomer,
  formData: FormData,
) {
  const validatedFields = UpdateCustomer.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    image_url: formData.get('image_url'),
    image_upload: formData.get('image_upload'),
  });
  
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Update Invoice.',
    };
  }
  
  const { name, email, image_url, image_upload } = validatedFields.data;
  
  /* const fs = require('fs');
  fs.writeFile("./public/customers/test.png", image_upload, (err: any) => {
    if (err)
      console.log(err);
    else {
      console.log("File written successfully\n");
      console.log("The written has the following contents:");
    }
  }); */
  const file = formData.get("image_upload");
  if (!file) {
    return { message: 'No files received.' };
  }
  const buffer = Buffer.from(await image_upload.arrayBuffer());
  //const filename =  image_upload.name.replaceAll(" ", "_");
  const filename = sanitizeAndTimestampFilename(image_upload.name);
  console.log(filename);
  try {
    await writeFile(
      path.join(process.cwd(), "/public/customers/" + filename),
      buffer
    );
    console.log("archivo subido correctamente", filename);
  } catch (error) {
    console.log("Error occured ", error);
    return { message: 'Error occured al grabar archivo.' };
  }

  try {
    await sql`
      UPDATE customers
      SET name = ${name}, email = ${email}, image_url = ${'/customers/'+filename} 
      WHERE id = ${id}
    `;//${image_url}
  } catch (error) {
    console.log("Error occured ", filename);
    return { message: 'Database Error: Failed to Update Customer.' };
  }
  
  revalidatePath('/dashboard/customers');
  redirect('/dashboard/customers');
}

export async function deleteCustomer(id: string) {
  await sql`DELETE FROM customers WHERE id = ${id}`;
  revalidatePath('/dashboard/customers');
}

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    await signIn('credentials', formData);
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  }
}