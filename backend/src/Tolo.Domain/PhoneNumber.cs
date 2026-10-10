using System.Text.RegularExpressions;

namespace Tolo.Domain;

/// <summary>
/// Normalizes an Ethiopian mobile number to +251XXXXXXXXX. Same rules as supabase/functions/_shared/phone.ts:
/// accepts "+251", "251" or a leading "0", ignores spaces, dashes and parentheses, and returns null for
/// anything that is not a 9-digit number starting with 7 or 9. Callers must treat null as "reject".
/// </summary>
public static partial class PhoneNumber
{
    [GeneratedRegex("[^\\d+]")]
    private static partial Regex NonDigits();

    [GeneratedRegex("^[79]\\d{8}$")]
    private static partial Regex Subscriber();

    public static string? NormalizeEthiopian(string? input)
    {
        if (input is null) return null;
        var digits = NonDigits().Replace(input, "");

        string rest;
        if (digits.StartsWith("+251", StringComparison.Ordinal)) rest = digits[4..];
        else if (digits.StartsWith("251", StringComparison.Ordinal)) rest = digits[3..];
        else if (digits.StartsWith('0')) rest = digits[1..];
        else rest = digits.TrimStart('+');

        return Subscriber().IsMatch(rest) ? "+251" + rest : null;
    }
}
