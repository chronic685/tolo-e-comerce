# One Dockerfile for both deployables. Build the API (default) or the worker:
#   docker build -t tolo-api backend
#   docker build -t tolo-worker --build-arg PROJECT=Tolo.Worker backend
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG PROJECT=Tolo.Api
WORKDIR /src
COPY Directory.Build.props Tolo.slnx ./
COPY src/ src/
RUN dotnet publish src/${PROJECT}/${PROJECT}.csproj -c Release -o /app --no-self-contained

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
ARG PROJECT=Tolo.Api
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_EnableDiagnostics=0 \
    ENTRYPOINT_DLL=${PROJECT}.dll
EXPOSE 8080
# The image's built-in non-root user.
USER $APP_UID
ENTRYPOINT ["sh", "-c", "exec dotnet \"$ENTRYPOINT_DLL\""]
