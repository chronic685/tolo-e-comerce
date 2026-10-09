using Tolo.Domain.Abstractions;
using Tolo.Domain.Contracts;

namespace Tolo.Domain.Services;

public static class PaymentMethods
{
    public const string CashOnDelivery = "cash_on_delivery";
    public const string AlreadyPaid = "already_paid";
}

/// <summary>
/// Receives a delivery job from the marketplace (docs/integration/delivery-handoff.md). Idempotent on job_id:
/// a repeat returns the same success and creates nothing new.
/// </summary>
public sealed class DeliveryJobIntake(IDeliveryJobStore store)
{
    public sealed record Outcome(bool Accepted, IReadOnlyList<string> Errors, bool Created);

    public async Task<Outcome> ReceiveAsync(DeliveryJobRequest? job, CancellationToken ct = default)
    {
        var errors = Validate(job, out var jobId);
        if (errors.Count > 0) return new Outcome(false, errors, false);

        var created = await store.AddIfAbsentAsync(jobId, job!, ct);
        return new Outcome(true, [], created);
    }

    public static List<string> Validate(DeliveryJobRequest? job, out Guid jobId)
    {
        jobId = Guid.Empty;
        var errors = new List<string>();
        if (job is null) return ["body is required"];

        if (!Guid.TryParse(job.JobId, out jobId) || jobId == Guid.Empty) errors.Add("job_id must be a uuid");
        if (string.IsNullOrWhiteSpace(job.OrderNumber)) errors.Add("order_number is required");

        CheckLocation(job.Pickup, "pickup", phoneRequired: false, errors);
        CheckLocation(job.Dropoff, "dropoff", phoneRequired: true, errors);

        if (job.Items is null || job.Items.Count == 0) errors.Add("items must not be empty");
        else if (job.Items.Any(i => string.IsNullOrWhiteSpace(i.Name) || i.Quantity is null or < 1)) errors.Add("each item needs a name and a quantity of at least 1");

        var a = job.Amounts;
        if (a is null) errors.Add("amounts is required");
        else
        {
            if (a.Currency != "ETB") errors.Add("amounts.currency must be ETB");
            if (a.ItemSubtotal is null or < 0 || a.Discount is null or < 0 || a.DeliveryFee is null or < 0 || a.RiderTip is null or < 0)
                errors.Add("amounts.item_subtotal, discount, delivery_fee and rider_tip must be non-negative numbers");
        }

        var p = job.Payment;
        if (p is null) errors.Add("payment is required");
        else if (p.Method is not (PaymentMethods.CashOnDelivery or PaymentMethods.AlreadyPaid)) errors.Add("payment.method must be cash_on_delivery or already_paid");
        else if (p.DriverCollectsCash != (p.Method == PaymentMethods.CashOnDelivery)) errors.Add("payment.driver_collects_cash must be true exactly for cash_on_delivery");

        return errors;
    }

    private static void CheckLocation(JobLocation? loc, string name, bool phoneRequired, List<string> errors)
    {
        if (loc is null) { errors.Add($"{name} is required"); return; }
        if (string.IsNullOrWhiteSpace(loc.Name)) errors.Add($"{name}.name is required");
        // The marketplace never sends a job with no location at all; address and coordinates may each be null.
        var hasCoords = loc.Latitude is not null && loc.Longitude is not null;
        if (string.IsNullOrWhiteSpace(loc.Address) && !hasCoords) errors.Add($"{name} needs an address or coordinates");
        if (loc.Latitude is { } lat && lat is < -90 or > 90) errors.Add($"{name}.latitude is out of range");
        if (loc.Longitude is { } lng && lng is < -180 or > 180) errors.Add($"{name}.longitude is out of range");
        if (phoneRequired && PhoneNumber.NormalizeEthiopian(loc.Phone) is null) errors.Add($"{name}.phone must be a valid Ethiopian mobile number");
    }
}
