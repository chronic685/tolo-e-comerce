using System.Net.Http.Headers;
using System.Net.Http.Json;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Contracts;

namespace Tolo.Infrastructure.Marketplace;

public sealed class MarketplaceOptions
{
    /// <summary>MARKETPLACE_FUNCTIONS_URL, e.g. https://abc.supabase.co/functions/v1 (no trailing slash needed).</summary>
    public string? FunctionsUrl { get; set; }

    /// <summary>TOLO_BACKEND_INBOUND_KEY: the bearer this backend sends TO the marketplace.</summary>
    public string? InboundKey { get; set; }
}

/// <summary>Typed HttpClient for the marketplace's Edge Functions. Never logs the phone, the key or a body.</summary>
public sealed class MarketplaceClient(HttpClient http, MarketplaceOptions options) : IMarketplaceClient
{
    public async Task<MerchantApplicationStatus> GetMerchantApplicationStatusAsync(string verifiedPhone, CancellationToken ct = default)
    {
        using var response = await PostAsync("merchant-application-status", new { phone = verifiedPhone }, ct);
        if (!response.IsSuccessStatusCode) throw new MarketplaceUnavailableException($"merchant-application-status returned HTTP {(int)response.StatusCode}.");
        try
        {
            return await response.Content.ReadFromJsonAsync<MerchantApplicationStatus>(ct)
                ?? throw new MarketplaceUnavailableException("merchant-application-status returned an empty body.");
        }
        catch (System.Text.Json.JsonException ex)
        {
            throw new MarketplaceUnavailableException("merchant-application-status returned an unreadable body.", ex);
        }
    }

    public async Task SendDeliveryStatusAsync(DeliveryStatusCallback callback, CancellationToken ct = default)
    {
        using var response = await PostAsync("delivery-status-callback", callback, ct);
        var code = (int)response.StatusCode;
        if (response.IsSuccessStatusCode) return;
        // The contract: do not retry a 4xx; retry anything else until a 200.
        if (code is >= 400 and < 500) throw new MarketplaceRejectedException(code);
        throw new MarketplaceUnavailableException($"delivery-status-callback returned HTTP {code}.");
    }

    private async Task<HttpResponseMessage> PostAsync<T>(string function, T body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(options.FunctionsUrl) || string.IsNullOrWhiteSpace(options.InboundKey))
            throw new MarketplaceUnavailableException("The marketplace URL or inbound key is not configured.");

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{options.FunctionsUrl.TrimEnd('/')}/{function}")
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.InboundKey);
        try
        {
            return await http.SendAsync(request, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new MarketplaceUnavailableException("The marketplace could not be reached.", ex);
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            throw new MarketplaceUnavailableException("The marketplace timed out.", ex);
        }
    }
}
