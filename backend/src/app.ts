import 'reflect-metadata';
import { BadRequestException, Body, Catch, Controller, ExceptionFilter, Get, Headers, HttpException,
  HttpCode, Inject, Module, Post, ArgumentsHost } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AccountStore } from './account';
import { IdentityVerifier } from './auth';

@Controller()
class AccountController {
  constructor(@Inject('AUTH') private readonly auth: IdentityVerifier,
    @Inject('ACCOUNTS') private readonly accounts: AccountStore) {}
  @Get('health') health() { return { status: 'ok' }; }
  @Get('me') async me(@Headers('authorization') header: string | undefined) {
    return this.accounts.load(await this.auth.verify(header), false);
  }
  @Post('me/profile') @HttpCode(200)
  async provision(@Headers('authorization') header: string | undefined, @Body() body: unknown) {
    const authId = await this.auth.verify(header);
    if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 0)) {
      throw new BadRequestException({ code: 'UNEXPECTED_FIELDS', message: 'Send an empty JSON object.' });
    }
    return this.accounts.load(authId, true);
  }
}

@Catch()
class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    response.setHeader('Cache-Control', 'no-store');
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
    } else {
      // No database details, connection strings, or tokens in client errors.
      response.status(503).json({ code: 'SERVICE_UNAVAILABLE' });
    }
  }
}

export async function createApp(auth: IdentityVerifier, accounts: AccountStore) {
  @Module({ controllers: [AccountController], providers: [
    { provide: 'AUTH', useValue: auth }, { provide: 'ACCOUNTS', useValue: accounts },
  ] }) class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ApiErrors());
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.enableShutdownHooks();
  return app;
}
